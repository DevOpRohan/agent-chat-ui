import { expect, test, type Page, type Route } from "@playwright/test";

const limitMessage =
  "Each message allows up to 20 images and 2 PDFs. No files from this selection were uploaded. Remove attachments or choose fewer files.";
const file = (name: string) => ({
  name,
  mimeType: name.endsWith(".pdf") ? "application/pdf" : "image/png",
  buffer: Buffer.from("test fixture"),
});

async function openChat(page: Page) {
  const fixture = {
    submits: [] as Route[],
    holdSubmit: false,
    uploads: [] as string[],
    held: [] as Route[],
    hold: false,
    fail: "",
    omitPageCount: false,
    pages: {} as Record<string, number>,
    preflights: [] as string[][],
    holdPreflight: false,
    heldPreflights: [] as Route[],
    preflightError: "",
  };
  const response = (name: string) => ({
    httpsUrl: `${new URL(page.url()).origin}/fixture.png`,
    gsUrl: `gs://fixture/${name}`,
    filename: name,
    mime_type: name.endsWith(".pdf") ? "application/pdf" : "image/png",
    openaiFileId: `file-${name}`,
    size: 12,
    ...(fixture.omitPageCount ? {} : { page_count: fixture.pages[name] ?? 1 }),
  });
  const pageResponse = (names: string[]) => {
    const counts = names.map((name) => fixture.pages[name] ?? 1);
    const total = counts.reduce((sum, count) => sum + count, 0);
    return fixture.preflightError
      ? { status: 422, json: { error: fixture.preflightError } }
      : total > 64
        ? {
            status: 422,
            json: {
              error: `PDF attachments may contain at most 64 pages combined; received ${total}. Select fewer pages or split the source before uploading.`,
            },
          }
        : { json: { page_counts: counts, total_pages: total } };
  };
  await page.route("**/api/upload/pdf-pages", async (route) => {
    const names = [
      ...(route.request().postData() || "").matchAll(/filename="([^"]+)"/g),
    ].map((match) => match[1]);
    fixture.preflights.push(names);
    if (fixture.holdPreflight) {
      fixture.heldPreflights.push(route);
      return;
    }
    await route.fulfill(pageResponse(names));
  });
  await page.route("**/api/upload", async (route) => {
    const name =
      route
        .request()
        .postData()
        ?.match(/filename="([^"]+)"/)?.[1] ?? "missing";
    fixture.uploads.push(name);
    if (fixture.hold) {
      fixture.held.push(route);
      return;
    }
    await route.fulfill(
      name === fixture.fail
        ? { status: 500, json: { error: "Fixture upload failed" } }
        : { json: response(name) },
    );
  });
  await page.route("**/fixture.png", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
    }),
  );
  await page.route("**/attachment-api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (
      path.endsWith("/runs") &&
      route.request().method() === "POST" &&
      fixture.holdSubmit
    ) {
      fixture.submits.push(route);
      return;
    }
    const thread = {
      thread_id: "thread",
      created_at: "2026-10-08T00:00:00Z",
      updated_at: "2026-10-08T00:00:00Z",
      status: "idle",
      metadata: {},
      values: { messages: [] },
    };
    const json = path.endsWith("/state")
      ? { values: thread.values, next: [], tasks: [], checkpoint: null }
      : path.endsWith("/search")
        ? [thread]
        : path.endsWith("/history") || path.endsWith("/runs")
          ? []
          : thread;
    await route.fulfill({ json });
  });
  await page.goto("/");
  const apiUrl = `${new URL(page.url()).origin}/attachment-api`;
  await page.goto(
    `/?${new URLSearchParams({ apiUrl, assistantId: "fixture", threadId: "thread" })}`,
  );
  await expect(page.getByTestId("attachment-counts")).toHaveText(
    "0/20 images · 0/2 PDFs",
  );
  return {
    fixture,
    releasePreflight: async () => {
      fixture.holdPreflight = false;
      for (const route of fixture.heldPreflights.splice(0)) {
        const names = [
          ...(route.request().postData() || "").matchAll(/filename="([^"]+)"/g),
        ].map((match) => match[1]);
        await route.fulfill(pageResponse(names));
      }
    },
    release: async () => {
      fixture.hold = false;
      for (const route of fixture.held.splice(0)) {
        const name =
          route
            .request()
            .postData()
            ?.match(/filename="([^"]+)"/)?.[1] ?? "missing";
        await route.fulfill({ json: response(name) });
      }
    },
  };
}

async function transfer(page: Page, names: string[], action: "drop" | "paste") {
  await page.evaluate(
    ({ names, action }) => {
      const data = new DataTransfer();
      for (const name of names)
        data.items.add(
          new File(["fixture"], name, {
            type: name.endsWith(".pdf") ? "application/pdf" : "image/png",
          }),
        );
      if (action === "drop")
        window.dispatchEvent(
          new DragEvent("drop", {
            dataTransfer: data,
            bubbles: true,
            cancelable: true,
          }),
        );
      else
        document.querySelector("textarea")!.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData: data,
            bubbles: true,
            cancelable: true,
          }),
        );
    },
    { names, action },
  );
}

test("picker rejects an excess batch, accepts 20 images plus 2 PDFs, and releases removed capacity", async ({
  page,
}) => {
  const { fixture } = await openChat(page);
  const picker = page.locator('input[type="file"]');
  await picker.setInputFiles([file("a.pdf"), file("b.pdf"), file("c.pdf")]);
  await expect(page.getByText(limitMessage)).toBeVisible();
  expect(fixture.uploads).toHaveLength(0);
  await picker.setInputFiles([
    ...Array.from({ length: 20 }, (_, i) => file(`${i}.png`)),
    file("a.pdf"),
    file("b.pdf"),
  ]);
  await expect(
    page.getByRole("button", { name: "Remove image", exact: true }),
  ).toHaveCount(20);
  await expect(
    page.getByRole("button", { name: "Remove PDF", exact: true }),
  ).toHaveCount(2);
  await expect(page.getByTestId("attachment-counts")).toHaveText(
    "20/20 images · 2/2 PDFs",
  );
  expect(fixture.uploads).toHaveLength(22);
  await transfer(page, ["extra.png"], "paste");
  await transfer(page, ["extra.pdf"], "drop");
  expect(fixture.uploads).toHaveLength(22);
  await page
    .getByRole("button", { name: "Remove PDF", exact: true })
    .first()
    .click();
  await picker.setInputFiles([file("replacement.pdf")]);
  await expect(
    page.getByText("replacement.pdf", { exact: true }),
  ).toBeVisible();
  expect(fixture.uploads).toHaveLength(23);
});

test("drop and paste include in-flight reservations and prevent same-batch duplicates", async ({
  page,
}) => {
  const { fixture, release } = await openChat(page);
  fixture.hold = true;
  await transfer(page, ["a.pdf", "b.pdf", "a.pdf"], "drop");
  await expect.poll(() => fixture.uploads.length).toBe(2);
  await expect(page.getByTestId("attachment-counts")).toHaveText(
    "0/20 images · 2/2 PDFs",
  );
  await transfer(page, ["third.pdf"], "paste");
  await expect(page.getByText(limitMessage)).toBeVisible();
  await transfer(page, ["one.png"], "paste");
  await expect.poll(() => fixture.uploads.length).toBe(3);
  await page
    .getByPlaceholder("Type your message...")
    .fill("Keep this draft while uploading");
  await page.getByPlaceholder("Type your message...").press("Enter");
  await expect(page.getByPlaceholder("Type your message...")).toHaveValue(
    "Keep this draft while uploading",
  );
  await release();
  await expect(
    page.getByRole("button", { name: "Remove PDF", exact: true }),
  ).toHaveCount(2);
  await expect(page.getByTestId("attachment-counts")).toHaveText(
    "1/20 images · 2/2 PDFs",
  );
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeEnabled();
});

test("partial failure preserves successful uploads and permits retry on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { fixture } = await openChat(page);
  fixture.pages = { "ok.pdf": 32, "failed.pdf": 32 };
  fixture.fail = "failed.pdf";
  await transfer(page, ["ok.pdf", "failed.pdf"], "paste");
  await expect(page.getByText("Fixture upload failed")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove PDF", exact: true }),
  ).toHaveCount(1);
  await expect(page.getByTestId("attachment-counts")).toHaveText(
    "0/20 images · 1/2 PDFs",
  );
  fixture.fail = "";
  await transfer(page, ["failed.pdf"], "drop");
  await expect(
    page.getByRole("button", { name: "Remove PDF", exact: true }),
  ).toHaveCount(2);
  await expect(page.getByTestId("attachment-counts")).toBeInViewport();
  await expect(page.getByTestId("pdf-page-count")).toHaveText(
    "64/64 PDF pages",
  );
  await expect(page.getByText("Fixture upload failed")).not.toBeVisible();
  await page.screenshot({ path: "test-results/attachment-limits-mobile.png" });
});

test("restored attachments preserve new files and block an oversized retry", async ({
  page,
}) => {
  const { fixture } = await openChat(page);
  const picker = page.locator('input[type="file"]');
  await picker.setInputFiles([file("original-a.pdf"), file("original-b.pdf")]);
  await expect(
    page.getByRole("button", { name: "Remove PDF", exact: true }),
  ).toHaveCount(2);
  fixture.holdSubmit = true;
  await page
    .getByPlaceholder("Type your message...")
    .fill("Retry this request");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => fixture.submits.length).toBe(1);
  await picker.setInputFiles([file("new-a.pdf"), file("new-b.pdf")]);
  await expect(
    page.getByRole("button", { name: "Remove PDF", exact: true }),
  ).toHaveCount(2);
  await fixture.submits[0].fulfill({
    status: 429,
    headers: { "X-User-Limit-Code": "DAILY_COST_LIMIT_EXCEEDED" },
    json: { detail: "DAILY_COST_LIMIT_EXCEEDED" },
  });
  await expect(
    page.getByRole("button", { name: "Remove PDF", exact: true }),
  ).toHaveCount(4);
  await expect(page.getByTestId("attachment-counts")).toHaveText(
    "0/20 images · 4/2 PDFs",
  );
  await page.getByPlaceholder("Type your message...").press("Enter");
  await expect(
    page.getByText(
      "Each message allows up to 20 images and 2 PDFs. Remove extra attachments before sending.",
    ),
  ).toBeVisible();
  expect(fixture.submits).toHaveLength(1);
});

for (const action of ["picker", "paste", "drop"] as const) {
  test(`${action} rejects 32+33 pages before upload and accepts 32+32`, async ({
    page,
  }) => {
    const { fixture } = await openChat(page);
    fixture.pages = { "a.pdf": 32, "b.pdf": 33 };
    const select = async () =>
      action === "picker"
        ? page
            .locator('input[type="file"]')
            .setInputFiles([file("a.pdf"), file("b.pdf")])
        : transfer(page, ["a.pdf", "b.pdf"], action);
    await select();
    await expect(
      page.getByText(/64 pages combined; received 65/),
    ).toBeVisible();
    expect(fixture.uploads).toHaveLength(0);
    await expect(page.getByTestId("pdf-page-count")).toHaveText(
      "0/64 PDF pages",
    );
    fixture.pages["b.pdf"] = 32;
    await select();
    await expect(
      page.getByRole("button", { name: "Remove PDF", exact: true }),
    ).toHaveCount(2);
    await expect(page.getByTestId("pdf-page-count")).toHaveText(
      "64/64 PDF pages",
    );
    await page
      .getByRole("button", { name: "Remove PDF", exact: true })
      .first()
      .click();
    await expect(page.getByTestId("pdf-page-count")).toHaveText(
      "32/64 PDF pages",
    );
    await page.screenshot({ path: `test-results/pdf-pages-${action}.png` });
  });
}

test("concurrent preflights reserve completed and unfinished PDF pages atomically", async ({
  page,
}) => {
  const { fixture, release, releasePreflight } = await openChat(page);
  fixture.pages = { "a.pdf": 32, "b.pdf": 33 };
  fixture.holdPreflight = true;
  fixture.hold = true;
  await transfer(page, ["a.pdf"], "drop");
  await expect.poll(() => fixture.preflights.length).toBe(1);
  await transfer(page, ["b.pdf"], "paste");
  await expect(page.getByTestId("attachment-counts")).toHaveText(
    "0/20 images · 2/2 PDFs",
  );
  expect(fixture.preflights).toHaveLength(1);
  await releasePreflight();
  await expect(page.getByText(/64 pages combined; received 65/)).toBeVisible();
  expect(fixture.uploads).toEqual(["a.pdf"]);
  await expect(page.getByTestId("pdf-page-count")).toHaveText(
    "32/64 PDF pages",
  );
  await release();
  await expect(
    page.getByRole("button", { name: "Remove PDF", exact: true }),
  ).toHaveCount(1);
  await transfer(page, ["b.pdf"], "paste");
  await expect.poll(() => fixture.preflights.length).toBe(3);
  expect(fixture.uploads).toEqual(["a.pdf"]);
});

test("unreadable preflight releases reservations and failed uploads release pages", async ({
  page,
}) => {
  const { fixture } = await openChat(page);
  fixture.preflightError =
    "Could not verify PDF page count. Use an unencrypted, readable PDF.";
  await transfer(page, ["a.pdf"], "paste");
  await expect(page.getByText(fixture.preflightError)).toBeVisible();
  await expect(page.getByTestId("attachment-counts")).toHaveText(
    "0/20 images · 0/2 PDFs",
  );
  expect(fixture.uploads).toHaveLength(0);
  fixture.preflightError = "";
  fixture.pages = { "a.pdf": 64, "b.pdf": 64 };
  fixture.fail = "a.pdf";
  await transfer(page, ["a.pdf"], "drop");
  await expect(page.getByText("Fixture upload failed")).toBeVisible();
  await expect(page.getByTestId("pdf-page-count")).toHaveText("0/64 PDF pages");
  await transfer(page, ["b.pdf"], "paste");
  await expect(
    page.getByRole("button", { name: "Remove PDF", exact: true }),
  ).toHaveCount(1);
  await expect(page.getByTestId("pdf-page-count")).toHaveText(
    "64/64 PDF pages",
  );
});

test("restored PDFs cannot bypass the combined page cap", async ({ page }) => {
  const { fixture } = await openChat(page);
  fixture.pages = { "original.pdf": 32, "next.pdf": 33 };
  await transfer(page, ["original.pdf"], "paste");
  await expect(page.getByTestId("pdf-page-count")).toHaveText(
    "32/64 PDF pages",
  );
  fixture.holdSubmit = true;
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => fixture.submits.length).toBe(1);
  await transfer(page, ["next.pdf"], "paste");
  await expect(page.getByTestId("pdf-page-count")).toHaveText(
    "33/64 PDF pages",
  );
  await fixture.submits[0].fulfill({
    status: 422,
    json: {
      detail: {
        code: "PDF_PAGE_LIMIT_EXCEEDED",
        message:
          "PDF attachments may contain at most 64 pages combined; received 65. Select fewer pages or split the source before uploading.",
      },
    },
  });
  await expect(
    page.getByText("PDF page limit exceeded", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("pdf-page-count")).toHaveText(
    "65/64 PDF pages",
  );
  await page.getByPlaceholder("Type your message...").press("Enter");
  await expect(
    page.getByText(/PDF attachments contain 65 pages; maximum 64/),
  ).toBeVisible();
  expect(fixture.submits).toHaveLength(1);
});

test("PDFs without verified upload metadata cannot submit", async ({
  page,
}) => {
  const { fixture } = await openChat(page);
  fixture.omitPageCount = true;
  await transfer(page, ["unknown.pdf"], "paste");
  await expect(page.getByTestId("pdf-page-count")).toHaveText(
    "Reattach PDFs to verify pages",
  );
  fixture.holdSubmit = true;
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByText(
      "Remove and reattach the PDFs so their page count can be verified before sending.",
    ),
  ).toBeVisible();
  expect(fixture.submits).toHaveLength(0);
});
