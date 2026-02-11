import type { Page } from "@playwright/test";

const CHAT_COMPOSER_PLACEHOLDER = "Type your message...";
const DEFAULT_TIMEOUT_MS = 20_000;

export type ChatEnvironmentGate = { ok: true } | { ok: false; reason: string };

function iapGateReason(): string {
  const hasBearer = Boolean(process.env.PLAYWRIGHT_AUTH_BEARER);
  const manualLogin = process.env.PLAYWRIGHT_MANUAL_LOGIN === "1";

  if (hasBearer) {
    return "IAP sign-in page detected. PLAYWRIGHT_AUTH_BEARER is present but appears invalid/expired for this environment.";
  }

  if (manualLogin) {
    return "IAP sign-in page detected. Complete manual login in setup before running this suite.";
  }

  return "IAP sign-in page detected. Provide PLAYWRIGHT_AUTH_BEARER or run with PLAYWRIGHT_MANUAL_LOGIN=1.";
}

async function isIapSignInPage(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes("accounts.google.com")) {
    return true;
  }

  const signInHeading = await page
    .getByRole("heading", { name: /^Sign in$/i })
    .isVisible()
    .catch(() => false);
  const signInWithGoogle = await page
    .getByText("Sign in with Google")
    .isVisible()
    .catch(() => false);
  const emailOrPhoneInput = await page
    .getByRole("textbox", { name: /Email or phone/i })
    .isVisible()
    .catch(() => false);

  return emailOrPhoneInput && (signInHeading || signInWithGoogle);
}

async function isBootstrapSetupPage(page: Page): Promise<boolean> {
  const continueButtonVisible = await page
    .getByRole("button", { name: /continue/i })
    .isVisible()
    .catch(() => false);
  const deploymentLabelVisible = await page
    .getByText(/deployment url/i)
    .isVisible()
    .catch(() => false);
  const assistantLabelVisible = await page
    .getByText(/assistant|graph id/i)
    .isVisible()
    .catch(() => false);

  return (
    continueButtonVisible && (deploymentLabelVisible || assistantLabelVisible)
  );
}

export async function detectChatEnvironment(
  page: Page,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ChatEnvironmentGate> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const composerVisible = await page
      .getByPlaceholder(CHAT_COMPOSER_PLACEHOLDER)
      .isVisible()
      .catch(() => false);
    if (composerVisible) {
      return { ok: true };
    }

    if (await isIapSignInPage(page)) {
      return { ok: false, reason: iapGateReason() };
    }

    if (await isBootstrapSetupPage(page)) {
      return {
        ok: false,
        reason:
          "Bootstrap setup form is visible. Configure NEXT_PUBLIC_API_URL and NEXT_PUBLIC_ASSISTANT_ID for this environment before running E2E.",
      };
    }

    await page.waitForTimeout(250);
  }

  return {
    ok: false,
    reason: `Chat composer '${CHAT_COMPOSER_PLACEHOLDER}' did not appear within ${timeoutMs}ms (current URL: ${page.url()}).`,
  };
}

export async function gotoAndDetectChatEnvironment(
  page: Page,
  url = "/",
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ChatEnvironmentGate> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return detectChatEnvironment(page, timeoutMs);
}
