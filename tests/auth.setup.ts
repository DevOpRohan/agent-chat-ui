import fs from "node:fs";
import path from "node:path";
import { test as setup, expect } from "@playwright/test";

const authFile = "playwright/.auth/user.json";

setup("authenticate once for e2e session", async ({ page, context }) => {
  const shouldUseManualLogin = process.env.PLAYWRIGHT_MANUAL_LOGIN === "1";
  if (!shouldUseManualLogin && fs.existsSync(authFile)) {
    return;
  }

  await page.goto("/");

  if (shouldUseManualLogin) {
    await page.pause();
  }

  const input = page.getByPlaceholder("Type your message...");
  await expect(input).toBeVisible({ timeout: 600_000 });

  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  await context.storageState({ path: authFile });
});
