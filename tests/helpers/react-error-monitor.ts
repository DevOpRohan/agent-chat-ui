import { expect, type Page } from "@playwright/test";

const REACT_ERROR_PATTERNS = [
  /minified react error #185/i,
  /\/errors\/185/i,
  /ignoring benign react #185 stream error/i,
  /maximum update depth exceeded/i,
  /too many re-renders/i,
];

function isReactStabilitySignal(text: string): boolean {
  return REACT_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

export function attachReactErrorMonitor(page: Page) {
  const signals: string[] = [];

  const record = (source: string, text: string) => {
    if (isReactStabilitySignal(text)) {
      signals.push(`[${source}] ${text}`);
    }
  };

  const onConsole = (message: { text(): string; type(): string }) => {
    record(`console:${message.type()}`, message.text());
  };
  const onPageError = (error: Error) => {
    record("pageerror", error.message || String(error));
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  return {
    assertClean() {
      expect(
        signals,
        `Detected React #185/max-depth signal(s):\n${signals.join("\n")}`,
      ).toEqual([]);
    },
    dispose() {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
    },
  };
}
