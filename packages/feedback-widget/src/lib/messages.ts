import { hasWindow, isObject, isString } from "@feeblo/utils/runtime-kind";
import type { WidgetModule } from "./config";
import { isSupportedLocale } from "./config";
import type { WidgetIdentity } from "./identity";

export type IdentityData = WidgetIdentity;
export type PublicIdentityData = Omit<IdentityData, "token">;

export type ParentMessage =
  | { event: "SHOW" }
  | { event: "HIDE" }
  | { event: "SET_CONTEXT"; data: Record<string, string> }
  | { event: "SET_MODULE"; data: { module: WidgetModule } }
  | { event: "SET_BOARD"; data: { board: string } }
  | { event: "SET_LOCALE"; data: { locale: string } }
  | { event: "IDENTIFY"; data: IdentityData };

export type ChildMessage =
  | { event: "READY" }
  | { event: "CLOSE" }
  | { event: "WIDGET_OPENED"; data: { module: WidgetModule } }
  | { event: "IDENTITY_CHANGED"; data: PublicIdentityData }
  | {
      event: "FEEDBACK_SUBMITTED";
      data: {
        post: {
          boardId: string;
          boardName: string;
          metadata?: Record<string, string>;
          title: string;
        };
      };
    };

const PARENT_EVENT_NAMES = new Set<string>([
  "SHOW",
  "HIDE",
  "SET_CONTEXT",
  "SET_MODULE",
  "SET_BOARD",
  "SET_LOCALE",
  "IDENTIFY",
]);

export function isParentMessage<T,>(
  value: T
): value is Extract<T, ParentMessage> {
  // SAFETY: isObject establishes that `value` is a non-null object; the
  // optional-field view below only exposes the claims the guard inspects.
  const record = isObject(value) ? (value as { event?: unknown; data?: unknown }) : undefined;
  if (record === undefined || !("event" in record)) {
    return false;
  }
  const event = record.event;
  if (!isString(event) || !PARENT_EVENT_NAMES.has(event)) {
    return false;
  }
  if (event === "SHOW" || event === "HIDE") {
    return true;
  }

  const data = record.data;
  if (Array.isArray(data) || !isObject(data)) {
    return false;
  }
  // SAFETY: isObject + Array.isArray establish that `data` is a plain
  // non-array object; the optional-field view only exposes the claims the
  // guard inspects, all of which are strings in the accepted message shapes.
  const dataRecord = data as {
    module?: string;
    board?: string;
    locale?: string;
    id?: string;
  };

  switch (event) {
    case "SET_CONTEXT":
      return Object.values(data).every((item) => isString(item));
    case "SET_MODULE":
      return (
        "module" in dataRecord &&
        (dataRecord.module === "feedback" || dataRecord.module === "updates")
      );
    case "SET_BOARD":
      return (
        "board" in dataRecord &&
        isString(dataRecord.board) &&
        dataRecord.board.length > 0
      );
    case "SET_LOCALE":
      return (
        "locale" in dataRecord &&
        isString(dataRecord.locale) &&
        isSupportedLocale(dataRecord.locale)
      );
    case "IDENTIFY":
      return (
        "id" in dataRecord && isString(dataRecord.id) && dataRecord.id.length > 0
      );
  }
  return false;
}

/**
 * The host origin the widget should post messages to. Prefer the explicit
 * `hostOrigin` query param the SDK adds to the iframe src; fall back to the
 * referrer for other embedders, and finally to `*` (which still only reaches
 * the immediate parent frame) so events keep flowing under no-referrer hosts.
 */
function resolveParentOrigin(): string | null {
  const param = new URLSearchParams(window.location.search).get("hostOrigin");
  if (param) {
    try {
      const origin = new URL(param).origin;
      if (origin !== "null") {
        return origin;
      }
    } catch {
      // ignore malformed param
    }
  }
  if (document.referrer) {
    try {
      const origin = new URL(document.referrer).origin;
      if (origin !== "null") {
        return origin;
      }
    } catch {
      // ignore malformed referrer
    }
  }
  return null;
}

let cachedParentOrigin: string | null | undefined;

/**
 * Lazily resolved parent origin, shared by all message senders/listeners.
 * `window.location` and `document.referrer` are stable for a widget document,
 * so URL parsing happens at most once per widget instance.
 */
function getParentOrigin(): string | null {
  if (cachedParentOrigin === undefined) {
    cachedParentOrigin = resolveParentOrigin();
  }
  return cachedParentOrigin;
}

export function sendToParent(message: ChildMessage): void {
  if (!hasWindow() || window.parent === window) {
    return;
  }
  window.parent.postMessage(message, getParentOrigin() ?? "*");
}

export function subscribeToParentMessages(
  handler: (message: ParentMessage) => void
): () => void {
  const parentOrigin = getParentOrigin();
  const listener = (e: MessageEvent<unknown>) => {
    if (e.source !== window.parent || !isParentMessage(e.data)) {
      return;
    }
    if (parentOrigin !== null && e.origin !== parentOrigin) {
      return;
    }
    handler(e.data);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
