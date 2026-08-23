import type { ReactNode } from "react";
import { Component } from "react";

/**
 * Widget→host messages replayed in tests. Structural subset of the SDK's
 * internal `IncomingMessage` contract, which is not part of its public API.
 */
export type WidgetToHostMessage =
  | { event: "CLOSE" }
  | { event: "READY" }
  | {
      data?:
        | { code?: string | undefined; message?: string | undefined }
        | undefined;
      event: "ERROR";
    }
  | { data?: { height?: number } | undefined; event: "PAGE_HEIGHT" };

/** Host→widget messages captured from the embed's postMessage traffic. */
export interface SentMessage {
  data?: unknown;
  event: string;
}

/**
 * The embed iframe points at the test server origin, so messages replayed
 * from the "widget" carry the same origin the embed whitelist expects.
 */
export const HOST_ORIGIN = window.location.origin;

/** Replay a postMessage as if it came from the widget iframe. */
export function postFromWidget(message: WidgetToHostMessage): void {
  window.dispatchEvent(
    new MessageEvent("message", { data: message, origin: HOST_ORIGIN })
  );
}

/**
 * Capture outgoing iframe traffic by shadowing the live iframe's
 * `contentWindow` with a recording stub. Returns the growing log.
 */
export function interceptIframePostMessages(): SentMessage[] {
  const iframe = document.querySelector("iframe");
  if (iframe === null) {
    throw new Error("No embed iframe found to intercept.");
  }
  const sent: SentMessage[] = [];
  Object.defineProperty(iframe, "contentWindow", {
    configurable: true,
    value: {
      postMessage: (message: SentMessage) => {
        sent.push(message);
      },
    },
  });
  return sent;
}

interface ErrorCatcherState {
  error: Error | null;
}

interface ErrorCatcherProps {
  children: ReactNode;
}

/** Render children while capturing render errors thrown beneath it. */
export class ErrorCatcher extends Component<
  ErrorCatcherProps,
  ErrorCatcherState
> {
  override state: ErrorCatcherState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorCatcherState {
    return { error };
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      return <output>{this.state.error.message}</output>;
    }
    return this.props.children;
  }
}
