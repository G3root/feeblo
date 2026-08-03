export type UserIdentityData = {
  avatar?: string;
  companies?: Array<{
    id: string;
    name: string;
    avatar?: string;
    customFields?: Record<string, unknown>;
  }>;
  customFields?: Record<string, unknown>;
  email?: string;
  id: string;
  name?: string;
  token?: string;
};

export type IdentityData = UserIdentityData;

export type ParentMessage =
  | { event: "SHOW" }
  | { event: "HIDE" }
  | { event: "SET_CONTEXT"; data: Record<string, string> }
  | { event: "SET_BOARD"; data: { board: string } }
  | { event: "SET_LOCALE"; data: { locale: string } }
  | { event: "IDENTIFY"; data: IdentityData };

export type ChildMessage =
  | { event: "READY" }
  | { event: "CLOSE" }
  | { event: "WIDGET_OPENED" }
  | { event: "WIDGET_CLOSED" }
  | { event: "IDENTITY_CHANGED"; data: IdentityData }
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
  "SET_BOARD",
  "SET_LOCALE",
  "IDENTIFY",
]);

export function isParentMessage(value: unknown): value is ParentMessage {
  if (typeof value !== "object" || value === null || !("event" in value)) {
    return false;
  }
  const event = (value as { event: unknown }).event;
  return typeof event === "string" && PARENT_EVENT_NAMES.has(event);
}

export function sendToParent(message: ChildMessage): void {
  if (typeof window === "undefined" || window.parent === window) {
    return;
  }
  let targetOrigin = "*";
  if (document.referrer) {
    try {
      targetOrigin = new URL(document.referrer).origin;
    } catch {
      targetOrigin = "*";
    }
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
