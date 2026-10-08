import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { blankPdf } from "./helpers/pdf-fixtures";
import {
  readPdfPageCount,
  requirePdfPageBudget,
} from "../src/lib/pdf-page-count";
import { getUserLimitNotice } from "../src/lib/user-limit-error";
import { jwtVerify } from "jose";
import {
  generationPinnedGcsUrl,
  signPdfPageCountReceipt,
} from "../src/lib/pdf-page-receipt";

async function loadRoute(path: string, mocks: Record<string, unknown> = {}) {
  const { build } = await import("esbuild");
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const bundle = await build({
    entryPoints: [path],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    packages: "external",
    alias: { "next/server": "next/server.js" },
  });
  const module = {
    exports: {} as { POST: (request: Request) => Promise<Response> },
  };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(
    (name: string) => mocks[name] || require(name),
    module,
    module.exports,
  );
  return {
    ...module.exports,
    NextRequest: require("next/server.js").NextRequest,
  };
}

test("Poppler counts real 64/65-page PDFs and rejects unreadable, encrypted and spoofed metadata", async () => {
  expect(await readPdfPageCount(blankPdf(64))).toBe(64);
  expect(await readPdfPageCount(blankPdf(65))).toBe(65);
  expect(() => requirePdfPageBudget(65)).toThrow("received 65");
  await expect(readPdfPageCount(Buffer.from("not a PDF"))).rejects.toThrow(
    "unencrypted, readable",
  );
  await expect(
    readPdfPageCount(readFileSync("tests/fixtures/encrypted.pdf")),
  ).rejects.toThrow("unencrypted, readable");
  await expect(
    readPdfPageCount(blankPdf(65, "spoof\\nPages: 1")),
  ).rejects.toThrow("unencrypted, readable");
});

test("count endpoint checks combined bytes before any storage upload and upload route rejects 65 pages", async ({
  baseURL,
  request,
}) => {
  for (const counts of [[64], [65], [32, 32], [32, 33]]) {
    const form = new FormData();
    counts.forEach((count, index) =>
      form.append("files", new Blob([blankPdf(count)]), `fixture-${index}.pdf`),
    );
    const response = await fetch(`${baseURL}/api/upload/pdf-pages`, {
      method: "POST",
      body: form,
    });
    const total = counts.reduce((sum, count) => sum + count, 0);
    expect(response.status).toBe(total > 64 ? 422 : 200);
    const body = await response.json();
    if (total > 64) expect(body.code).toBe("PDF_PAGE_LIMIT_EXCEEDED");
    else expect(body).toEqual({ page_counts: counts, total_pages: total });
  }
  const response = await request.post("/api/upload", {
    multipart: {
      file: {
        name: "oversized.pdf",
        mimeType: "application/pdf",
        buffer: blankPdf(65),
      },
    },
  });
  expect(response.status()).toBe(422);
  expect((await response.json()).code).toBe("PDF_PAGE_LIMIT_EXCEEDED");
  const unreadable = await request.post("/api/upload/pdf-pages", {
    multipart: {
      files: {
        name: "bad.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("not a PDF"),
      },
    },
  });
  expect(unreadable.status()).toBe(422);
});

test("pre-main PDF validation messages are actionable user notices", () => {
  const detail = {
    code: "PDF_PAGE_COUNT_UNAVAILABLE",
    message:
      "Could not verify PDF page count. Use an unencrypted, readable PDF with an accessible public URL.",
  };
  expect(
    getUserLimitNotice(new Error(`HTTP 422: ${JSON.stringify({ detail })}`))
      ?.description,
  ).toBe(detail.message);
});

test("reset during preflight does not block or contaminate the new draft", async ({
  page,
}) => {
  const { build } = await import("esbuild");
  const bundle = await build({
    stdin: {
      contents: `import React from "react";
      import { createRoot } from "react-dom/client";
      import { useFileUpload } from "./src/hooks/use-file-upload";
      function Harness() {
        const upload = useFileUpload();
        return <div ref={upload.dropRef}>
          <input type="file" onChange={upload.handleFileUpload} />
          <button onClick={upload.resetBlocks}>Reset draft</button>
          <output>{upload.contentBlocks.map(block => block.metadata?.filename).join(",")}:{upload.pdfPages}</output>
        </div>;
      }
      createRoot(document.getElementById("root")).render(<Harness/>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.NEXT_PUBLIC_MODEL_PROVIDER": '"OPENAI"',
    },
  });
  await page.route("**/hook-harness", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div><script src="/hook-harness.js"></script>',
    }),
  );
  await page.route("**/hook-harness.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: Buffer.from(bundle.outputFiles[0].contents),
    }),
  );
  let oldCheck: import("@playwright/test").Route | undefined;
  const uploads: string[] = [];
  await page.route("**/api/upload/pdf-pages", async (route) => {
    if (route.request().postData()?.includes("old.pdf")) {
      oldCheck = route;
      return;
    }
    await route.fulfill({ json: { page_counts: [32], total_pages: 32 } });
  });
  await page.route("**/api/upload", async (route) => {
    const name =
      route
        .request()
        .postData()
        ?.match(/filename="([^"]+)"/)?.[1] ?? "missing";
    uploads.push(name);
    await route.fulfill({
      json: {
        gsUrl: `gs://fixture/${name}`,
        httpsUrl: `https://fixture.invalid/${name}`,
        openaiFileId: `file-${name}`,
        mime_type: "application/pdf",
        filename: name,
        size: 10,
        page_count: 32,
      },
    });
  });
  await page.goto("/hook-harness");
  await page.locator('input[type="file"]').setInputFiles({
    name: "old.pdf",
    mimeType: "application/pdf",
    buffer: blankPdf(32),
  });
  await expect.poll(() => Boolean(oldCheck)).toBe(true);
  await page.getByRole("button", { name: "Reset draft" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "new.pdf",
    mimeType: "application/pdf",
    buffer: blankPdf(32),
  });
  await expect(page.locator("output")).toHaveText("new.pdf:32");
  await oldCheck!.fulfill({ json: { page_counts: [64], total_pages: 64 } });
  await expect(page.locator("output")).toHaveText("new.pdf:32");
  expect(uploads).toEqual(["new.pdf"]);
});

test("direct OpenAI upload rejects PDF bytes before an OpenAI Files request", async () => {
  const { POST, NextRequest } = await loadRoute(
    "src/app/api/openai/upload/route.ts",
  );
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const pdf = blankPdf(65);
  // This worker runs with OPENAI_API_KEY=fixture-only; no credential is loaded.
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push(url);
    if (url !== "https://fixture.invalid/source.bin")
      throw new Error("Unexpected external request");
    return new Response(init?.method === "HEAD" ? null : pdf, {
      headers: {
        "content-length": String(pdf.length),
        "content-type": "application/octet-stream",
      },
    });
  };
  try {
    const response = await POST(
      new NextRequest("http://fixture.invalid/api/openai/upload", {
        method: "POST",
        body: JSON.stringify({
          url: "https://fixture.invalid/source.bin",
          mime_type: "image/png",
          filename: "image.png",
        }),
      }),
    );
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("PDF_PAGE_LIMIT_EXCEEDED");
    expect(requests).toHaveLength(2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("PDF count receipts bind immutable versions and cannot be used as auth tokens", async () => {
  const key = new TextEncoder().encode("receipt-fixture-secret");
  const url = generationPinnedGcsUrl(
    "fixture-bucket",
    "folder/é a#(!).pdf",
    "1791416994825483",
  )!;
  expect(url).toBe(
    "https://storage.googleapis.com/fixture-bucket/folder%2F%C3%A9%20a%23%28%21%29.pdf?generation=1791416994825483",
  );
  const receipt = (await signPdfPageCountReceipt(32, url, "file-fixture"))!;
  const { payload } = await jwtVerify(receipt, key, {
    algorithms: ["HS256"],
    issuer: "agent-chat-ui/pdf-page-count",
    audience: "questioncrafter/pdf-page-count",
  });
  expect(payload).toMatchObject({
    purpose: "pdf-page-count",
    version: 1,
    page_count: 32,
    url,
    file_id: "file-fixture",
  });
  expect(payload.exp! - payload.iat!).toBe(30 * 24 * 60 * 60);
  await expect(
    jwtVerify(receipt, key, { audience: "questioncrafter-auth" }),
  ).rejects.toThrow();
  for (const source of [
    url.replace("?generation=1791416994825483", ""),
    url + "&other=1",
    url + "#fragment",
    url.replace("storage.googleapis.com", "fixture.invalid"),
  ])
    expect(await signPdfPageCountReceipt(32, source)).toBeUndefined();
  expect(
    generationPinnedGcsUrl("fixture", "a.pdf", 1791416994825483),
  ).toBeUndefined();
  delete process.env.LANGGRAPH_AUTH_JWT_SECRET;
  try {
    expect(await signPdfPageCountReceipt(32, url)).toBeUndefined();
  } finally {
    process.env.LANGGRAPH_AUTH_JWT_SECRET = "receipt-fixture-secret";
  }
});

test("upload signs actual counted bytes and pins the source from save metadata without another GCS request", async () => {
  const saves: Buffer[] = [];
  let objectName = "";
  class MockStorage {
    bucket(name: string) {
      expect(name).toBe("fixture-bucket");
      return {
        file(name: string) {
          objectName = name;
          const file = {
            metadata: {} as { generation?: string },
            async save(bytes: Buffer) {
              saves.push(bytes);
              file.metadata.generation = "1791416994825483";
            },
          };
          return file;
        },
      };
    }
  }
  const { POST, NextRequest } = await loadRoute("src/app/api/upload/route.ts", {
    "@google-cloud/storage": { Storage: MockStorage },
  });
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    expect(String(input)).toBe("https://api.openai.com/v1/files");
    return Response.json({ id: "file-fixture" });
  };
  try {
    const form = new FormData();
    form.append(
      "file",
      new Blob([blankPdf(32)], { type: "application/pdf" }),
      "é a#(!).pdf",
    );
    form.append("page_count", "1");
    form.append("page_count_receipt", "untrusted-client-value");
    const response = await POST(
      new NextRequest("http://fixture.invalid/api/upload", {
        method: "POST",
        body: form,
      }),
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.page_count).toBe(32);
    expect(data.httpsUrl).toBe(
      generationPinnedGcsUrl("fixture-bucket", objectName, "1791416994825483"),
    );
    const { payload } = await jwtVerify(
      data.page_count_receipt,
      new TextEncoder().encode("receipt-fixture-secret"),
      {
        algorithms: ["HS256"],
        issuer: "agent-chat-ui/pdf-page-count",
        audience: "questioncrafter/pdf-page-count",
      },
    );
    expect(payload).toMatchObject({
      page_count: 32,
      url: data.httpsUrl,
      file_id: data.openaiFileId,
    });
    expect(saves).toHaveLength(1);
    expect(requests).toEqual(["https://api.openai.com/v1/files"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fileToContentBlock preserves the receipt for URL and OpenAI ID attachments", async () => {
  const { fileToContentBlock } = await import("../src/lib/multimodal-utils");
  const originalFetch = globalThis.fetch;
  const originalProvider = process.env.NEXT_PUBLIC_MODEL_PROVIDER;
  const httpsUrl = generationPinnedGcsUrl(
    "fixture-bucket",
    "source.pdf",
    "1791416994825483",
  )!;
  globalThis.fetch = async () =>
    Response.json({
      gsUrl: "gs://fixture-bucket/source.pdf",
      httpsUrl,
      openaiFileId: "file-fixture",
      mime_type: "application/pdf",
      filename: "source.pdf",
      size: 123,
      page_count: 32,
      page_count_receipt: "synthetic-receipt",
    });
  try {
    for (const provider of ["OPENAI", "GEMINI"]) {
      process.env.NEXT_PUBLIC_MODEL_PROVIDER = provider;
      const block = await fileToContentBlock(
        new File([blankPdf(32)], "source.pdf", { type: "application/pdf" }),
      );
      expect(block.source_type).toBe(provider === "OPENAI" ? "id" : "url");
      expect(block.metadata).toMatchObject({
        httpsUrl,
        page_count: 32,
        page_count_receipt: "synthetic-receipt",
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalProvider === undefined)
      delete process.env.NEXT_PUBLIC_MODEL_PROVIDER;
    else process.env.NEXT_PUBLIC_MODEL_PROVIDER = originalProvider;
  }
});
