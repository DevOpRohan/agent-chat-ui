import { expect, test } from "@playwright/test";
import { gotoAndDetectChatEnvironment } from "./helpers/environment-gates";
import { attachReactErrorMonitor } from "./helpers/react-error-monitor";

const COMPLEX_NUMBER_PROMPT = [
  "Use at least one available tool before your final answer.",
  "Solve the complex-number expression ((3 + 4i)^2) / (1 - 2i).",
  "Return the final result in a + bi form with a short verification.",
].join(" ");

test("complex-number run exposes intermediate step details in the artifact pane", async ({
  page,
}) => {
  const gate = await gotoAndDetectChatEnvironment(page, "/");
  test.skip(!gate.ok, gate.reason);
  const reactErrorMonitor = attachReactErrorMonitor(page);

  try {
    const input = page.getByPlaceholder("Type your message...");
    await expect(input).toBeVisible({ timeout: 60_000 });

    await input.fill(COMPLEX_NUMBER_PROMPT);
    await page.getByRole("button", { name: "Send" }).click();

    const intermediateStepButton = page
      .getByRole("button", { name: /Intermediate Step/i })
      .first();
    await expect(intermediateStepButton).toBeVisible({ timeout: 120_000 });

    await intermediateStepButton.click();

    await expect(page.getByTestId("artifact-content")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByTestId("artifact-content").getByText("Intermediate Step"),
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("pane-artifact")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByText(/Tool Calls|Tool Result|Thinking/).first(),
    ).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      page.getByText("An error occurred. Please try again."),
    ).toHaveCount(0);
    reactErrorMonitor.assertClean();
  } finally {
    reactErrorMonitor.dispose();
  }
});
