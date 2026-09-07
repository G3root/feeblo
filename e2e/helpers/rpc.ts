import type { Page } from "@playwright/test";

/**
 * Resolves when the given Effect RPC method completes on the wire. Every
 * TanStack DB mutation syncs through `POST /rpc` with the method name in
 * the payload, so awaiting the response (rather than a UI side effect)
 * pins the test to persistence instead of optimistic UI.
 *
 * Capture the promise *before* the triggering action, then await it after:
 *
 * ```ts
 * const create = waitForRpc(page, "CommentCreate");
 * await page.getByRole("button", { name: "Comment Public" }).click();
 * await create;
 * ```
 */
export function waitForRpc(page: Page, method: string) {
  return page.waitForResponse(
    (response) =>
      response.url().includes("/rpc") &&
      Boolean(response.request().postData()?.includes(method))
  );
}
