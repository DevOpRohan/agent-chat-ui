import { expect, test, type Page } from "@playwright/test";

const DEFAULT_ARTIFACT_RATIO = 0.38;
const ARTIFACT_MIN_WIDTH = 320;
const ARTIFACT_MAX_RATIO = 0.62;
const CHAT_MIN_WIDTH = 360;

async function readPaneWidth(page: Page, testId: string): Promise<number> {
  return page.getByTestId(testId).evaluate((element) => {
    const width = element.getBoundingClientRect().width;
    return Math.round(width);
  });
}

async function dragHandle(page: Page, testId: string, deltaX: number) {
  const handle = page.getByTestId(testId);
  await expect(handle).toBeVisible({ timeout: 30_000 });
  const box = await handle.boundingBox();
  if (!box) {
    throw new Error(`Missing bounding box for ${testId}`);
  }
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY);
  await page.mouse.up();
}

async function openArtifactFromIntermediate(page: Page) {
  const intermediateStepButton = page
    .getByRole("button", { name: /Intermediate Step/i })
    .first();
  const hasIntermediateStep = await intermediateStepButton
    .isVisible()
    .catch(() => false);

  if (hasIntermediateStep) {
    await intermediateStepButton.click();
  } else {
    await page
      .getByTestId("open-artifact-panel-test-control")
      .dispatchEvent("click");
  }

  await expect
    .poll(() => readPaneWidth(page, "pane-artifact"), {
      timeout: 30_000,
      message: "Expected artifact pane to open",
    })
    .toBeGreaterThan(260);
}

async function ensureDesktopHistoryPaneVisible(page: Page) {
  const initialWidth = await readPaneWidth(page, "pane-history");
  if (initialWidth > 250) {
    return;
  }

  const historyToggle = page.getByTestId("chat-history-toggle").first();
  const canToggle = await historyToggle.isVisible().catch(() => false);
  if (canToggle) {
    await historyToggle.click();
  }

  await expect
    .poll(() => readPaneWidth(page, "pane-history"), {
      timeout: 30_000,
      message: "Expected desktop history pane to be visible",
    })
    .toBeGreaterThan(250);
}

function expectedDefaultArtifactWidth(
  viewportWidth: number,
  historyWidth: number,
): number {
  const mainWidth = Math.max(0, viewportWidth - historyWidth);
  const maxByChat = Math.max(0, mainWidth - CHAT_MIN_WIDTH);
  const maxByRatio = Math.max(0, Math.floor(mainWidth * ARTIFACT_MAX_RATIO));
  const maxWidth = Math.min(maxByChat, maxByRatio);
  const minWidth = Math.min(ARTIFACT_MIN_WIDTH, maxWidth);
  const base = Math.floor(mainWidth * DEFAULT_ARTIFACT_RATIO);
  return Math.round(Math.min(maxWidth, Math.max(minWidth, base)));
}

test("desktop panes resize, artifact expands full width, and sizes reset after reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?chatHistoryOpen=true");
  await page.evaluate(() => {
    window.dispatchEvent(new Event("resize"));
  });

  const input = page.getByPlaceholder("Type your message...");
  await expect(input).toBeVisible({ timeout: 60_000 });
  await ensureDesktopHistoryPaneVisible(page);

  const historyBefore = await readPaneWidth(page, "pane-history");
  const initialDefaultHistoryWidth = historyBefore;
  await dragHandle(page, "resize-handle-history-chat", -120);
  await expect
    .poll(() => readPaneWidth(page, "pane-history"), {
      timeout: 10_000,
      message: "Expected history pane to shrink after dragging",
    })
    .toBeLessThan(historyBefore - 40);

  await openArtifactFromIntermediate(page);

  const artifactBeforeResize = await readPaneWidth(page, "pane-artifact");
  await dragHandle(page, "resize-handle-chat-artifact", -140);
  await expect
    .poll(() => readPaneWidth(page, "pane-artifact"), {
      timeout: 10_000,
      message: "Expected artifact pane to grow after dragging left",
    })
    .toBeGreaterThan(artifactBeforeResize + 60);

  await dragHandle(page, "resize-handle-chat-artifact", 180);
  await expect
    .poll(() => readPaneWidth(page, "pane-artifact"), {
      timeout: 10_000,
      message: "Expected artifact pane to shrink after dragging right",
    })
    .toBeLessThan(artifactBeforeResize + 20);

  const preExpandHistoryWidth = await readPaneWidth(page, "pane-history");
  const preExpandArtifactWidth = await readPaneWidth(page, "pane-artifact");

  const expandToggle = page.getByTestId("artifact-expand-toggle");
  await expect(expandToggle).toHaveAttribute(
    "aria-label",
    "Expand artifact panel",
  );
  await expandToggle.click();

  await expect
    .poll(() => readPaneWidth(page, "pane-chat"), {
      timeout: 15_000,
      message: "Expected chat pane to collapse in artifact full-width mode",
    })
    .toBeLessThan(8);
  await expect
    .poll(() => readPaneWidth(page, "pane-history"), {
      timeout: 15_000,
      message: "Expected history pane to collapse in artifact full-width mode",
    })
    .toBeLessThan(8);

  const viewportWidth = await page.evaluate(() => window.innerWidth);
  await expect
    .poll(() => readPaneWidth(page, "pane-artifact"), {
      timeout: 15_000,
      message: "Expected artifact pane to consume full desktop width",
    })
    .toBeGreaterThan(Math.floor(viewportWidth * 0.85));

  await expect(expandToggle).toHaveAttribute(
    "aria-label",
    "Restore pane layout",
  );
  await expandToggle.click();

  const restoredHistoryWidth = await expect
    .poll(() => readPaneWidth(page, "pane-history"), {
      timeout: 15_000,
      message:
        "Expected history width to restore after leaving full-width mode",
    })
    .toBeGreaterThan(preExpandHistoryWidth - 20)
    .then(() => readPaneWidth(page, "pane-history"));
  expect(
    Math.abs(restoredHistoryWidth - preExpandHistoryWidth),
  ).toBeLessThanOrEqual(20);
  const restoredArtifactWidth = await expect
    .poll(() => readPaneWidth(page, "pane-artifact"), {
      timeout: 15_000,
      message:
        "Expected artifact width to restore after leaving full-width mode",
    })
    .toBeGreaterThan(preExpandArtifactWidth - 20)
    .then(() => readPaneWidth(page, "pane-artifact"));
  expect(
    Math.abs(restoredArtifactWidth - preExpandArtifactWidth),
  ).toBeLessThanOrEqual(20);

  const preReloadHistoryWidth = await readPaneWidth(page, "pane-history");
  const preReloadArtifactWidth = await readPaneWidth(page, "pane-artifact");

  await page.reload();
  await expect(input).toBeVisible({ timeout: 60_000 });
  await ensureDesktopHistoryPaneVisible(page);

  const historyAfterReload = await readPaneWidth(page, "pane-history");
  expect(
    Math.abs(historyAfterReload - initialDefaultHistoryWidth),
  ).toBeLessThanOrEqual(25);
  expect(Math.abs(historyAfterReload - preReloadHistoryWidth)).toBeGreaterThan(
    35,
  );

  await openArtifactFromIntermediate(page);

  const artifactAfterReload = await readPaneWidth(page, "pane-artifact");
  const expectedAfterReload = expectedDefaultArtifactWidth(
    viewportWidth,
    historyAfterReload,
  );

  expect(
    Math.abs(artifactAfterReload - expectedAfterReload),
  ).toBeLessThanOrEqual(45);
  expect(
    Math.abs(artifactAfterReload - preReloadArtifactWidth),
  ).toBeGreaterThan(30);
});
