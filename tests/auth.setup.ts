import fs from "node:fs";
import path from "node:path";
import { test as setup } from "@playwright/test";
import { detectChatEnvironment } from "./helpers/environment-gates";

const authFile = "playwright/.auth/user.json";
const emptyStorageState = {
  cookies: [],
  origins: [],
};

setup("authenticate once for e2e session", async ({ page, context }) => {
  const shouldUseManualLogin = process.env.PLAYWRIGHT_MANUAL_LOGIN === "1";
  fs.mkdirSync(path.dirname(authFile), { recursive: true });

  if (!shouldUseManualLogin && fs.existsSync(authFile)) {
    return;
  }

  await page.goto("/", { waitUntil: "domcontentloaded" });

  if (shouldUseManualLogin) {
    await page.pause();
  }

  const gate = await detectChatEnvironment(
    page,
    shouldUseManualLogin ? 600_000 : 20_000,
  );
  if (!gate.ok) {
    if (shouldUseManualLogin) {
      throw new Error(gate.reason);
    }

    // Keep chromium project launchable in gated environments.
    fs.writeFileSync(authFile, JSON.stringify(emptyStorageState, null, 2));
    return;
  }

  await context.storageState({ path: authFile });
});
