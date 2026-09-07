import { expect, type Page } from "@playwright/test";

/**
 * Records unexpected client-side failures for a page: uncaught exceptions
 * (`pageerror`) and `console.error` entries. Call once per page (typically
 * in `test.beforeEach`), then `assertNoPageErrors` at the end of the test
 * (typically in `test.afterEach`). Multi-page tests track each extra page
 * explicitly.
 *
 * Rationale: an uncaught render exception or a failed invariant currently
 * passes silently whenever the asserted elements still resolve. Failing on
 * them turns the whole suite into a client-health monitor for free.
 */
const errorsByPage = new WeakMap<Page, Array<string>>();

export function trackPageErrors(page: Page): void {
  if (errorsByPage.has(page)) {
    return;
  }
  const errors: Array<string> = [];
  errorsByPage.set(page, errors);
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`);
    }
  });
}

export async function assertNoPageErrors(
  page: Page,
  allowed: ReadonlyArray<RegExp> = []
): Promise<void> {
  const errors = (errorsByPage.get(page) ?? []).filter(
    (entry) => !allowed.some((pattern) => pattern.test(entry))
  );
  expect(
    errors,
    `Unexpected client errors:\n${errors.join("\n")}`
  ).toHaveLength(0);
}
