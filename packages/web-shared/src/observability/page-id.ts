/**
 * A random identity for the current browser document.
 *
 * It is never an authentication or user identifier: it exists so traces,
 * error reports and product events from one page load can be joined. Server
 * renders have no document, so they get none instead of sharing one per
 * isolate.
 */
import { hasWindow } from "@feeblo/utils/runtime-kind";

const pageIds = new WeakMap<Document, string>();

export const browserPageId = (): string | undefined => {
  if (!hasWindow()) return undefined;
  const existing = pageIds.get(document);
  if (existing !== undefined) return existing;
  const created = crypto.randomUUID();
  pageIds.set(document, created);
  return created;
};
