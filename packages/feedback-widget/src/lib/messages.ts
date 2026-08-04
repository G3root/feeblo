/** biome-ignore-all lint/style/useDefaultSwitchClause: <explanation> */
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
  | { event: "WIDGET_CLOSED" }
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

export function isParentMessage(value: unknown): value is ParentMessage {
  if (typeof value !== "object" || value === null || !("event" in value)) {
    return false;
  }
  const event = (value as { event: unknown }).event;
  if (typeof event !== "string" || !PARENT_EVENT_NAMES.has(event)) {
    return false;
  }
  if (event === "SHOW" || event === "HIDE") {
    return true;
  }

  const data = (value as { data?: unknown }).data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return false;
  }

  switch (event) {
    case "SET_CONTEXT":
      return Object.values(data).every((item) => typeof item === "string");
    case "SET_MODULE":
      return (
        "module" in data &&
        (data.module === "feedback" || data.module === "updates")
      );
    case "SET_BOARD":
      return (
        "board" in data &&
        typeof data.board === "string" &&
        data.board.length > 0
      );
    case "SET_LOCALE":
      return (
        "locale" in data &&
        typeof data.locale === "string" &&
        isSupportedLocale(data.locale)
      );
    case "IDENTIFY":
      return "id" in data && typeof data.id === "string" && data.id.length > 0;
  }
  return false;
}

export function sendToParent(message: ChildMessage): void {
  if (typeof window === "undefined" || window.parent === window) {
    return;
  }
  if (!document.referrer) {
    return;
  }
  let targetOrigin: string;
  try {
    targetOrigin = new URL(document.referrer).origin;
  } catch {
    return;
  }
  if (targetOrigin === "null") {
    return;
  }
  window.parent.postMessage(message, targetOrigin);
}

export function subscribeToParentMessages(
  handler: (message: ParentMessage) => void
): () => void {
  const listener = (e: MessageEvent<unknown>) => {
    if (e.source !== window.parent || !isParentMessage(e.data)) {
      return;
    }
    handler(e.data);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
