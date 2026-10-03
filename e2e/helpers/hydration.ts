import type { Page } from "@playwright/test";

/**
 * Waits until the server-rendered document has hydrated.
 *
 * A public board page paints its content before its JavaScript runs — that is
 * what SSR buys — so a click issued as soon as an element exists can land
 * before React has attached its handlers and be swallowed. Waiting for the
 * root shell's hydration marker first is what a real visitor's hands do
 * implicitly.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.documentElement.dataset.hydrated === "true"
  );
}
