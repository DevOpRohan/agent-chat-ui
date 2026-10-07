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
  };
  const response = (name: string) => ({
    httpsUrl: `${new URL(page.url()).origin}/fixture.png`,
    gsUrl: `gs://fixture/${name}`,
    filename: name,
    mime_type: name.endsWith(".pdf") ? "application/pdf" : "image/png",
    openaiFileId: `file-${name}`,
    size: 12,
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
