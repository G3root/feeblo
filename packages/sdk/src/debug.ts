import { VERSION } from "./version";

export type LogCategory =
  | "lifecycle"
  | "message"
  | "positioning"
  | "link"
  | "trigger"
  | "identity"
  | "config"
  | "event";

export interface Logger {
  readonly enabled: boolean;
  (category: LogCategory, ...args: unknown[]): void;
}

const LABEL_STYLE = "color: #6b7280; font-weight: 600";

/**
 * Create a debug logger. When `enabled` is false (the default) every call is a
 * no-op, so diagnostics have zero cost in production.
 */
export function createLogger(enabled: boolean): Logger {
  const log = (category: LogCategory, ...args: unknown[]): void => {
    if (!enabled) {
      return;
    }
    console.log(`%c[feeblo:${category}]`, LABEL_STYLE, ...args);
  };
  return Object.assign(log, { enabled }) as Logger;
}

/**
 * Emits a one-time banner describing the running SDK. Useful when debugging an
 * embed that was auto-initialised from a script tag.
 */
export function banner(orgId: string, baseUrl: string): void {
  console.info(
    `%c[feeblo]%c SDK v${VERSION} ready`,
    "color: #4f46e5; font-weight: 700",
    "color: inherit",
    { orgId, baseUrl }
  );
}
