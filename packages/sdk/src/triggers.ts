import { FEEDBACK_ATTRIBUTE } from "./constants";
import type { Logger } from "./debug";

const METADATA_KEY_REGEX = /^feeblo([A-Z]\w*)$/;

const FEEDBACK_DATASET_KEY = FEEDBACK_ATTRIBUTE.replace(/^data-/, "").replace(
  /-([a-z])/g,
  (_, c) => c.toUpperCase()
);

/**
 * `bindTriggers` marks an element it has already bound so the scan is
 * idempotent. The marker lives in the same `data-feeblo-*` namespace as
 * integrator metadata, so `METADATA_KEY_REGEX` matches it: without an explicit
 * skip every trigger click forwarded `bound: "true"` to the widget as though a
 * customer had written it. One constant is shared with `bindTriggers` so the
 * write, the read, and the skip cannot drift apart.
 */
const BOUND_DATASET_KEY = "feebloBound";

/**
 * The subset of an embed the trigger scanner needs. Mirrors the void-returning
 * methods on {@link Embed} so the scanner stays decoupled from the widget proxy.
 */
export interface TriggerTarget {
  open: (trigger?: HTMLElement, metadata?: Record<string, string>) => void;
  setBoard: (board: string) => void;
}

function findTriggers(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(`[${FEEDBACK_ATTRIBUTE}]`)
  );
}

export function extractTriggerMetadata(element: HTMLElement) {
  const metadata: Record<string, string> = {};
  for (const key of Object.keys(element.dataset)) {
    if (key === FEEDBACK_DATASET_KEY || key === BOUND_DATASET_KEY) {
      continue;
    }
    const match = key.match(METADATA_KEY_REGEX);
    if (match?.[1]) {
      const name = match[1].charAt(0).toLowerCase() + match[1].slice(1);
      const value = element.dataset[key];
      if (value !== undefined) {
        metadata[name] = value;
      }
    }
  }
  return metadata;
}

export function bindTriggers(target: TriggerTarget, logger?: Logger): void {
  for (const trigger of findTriggers()) {
    if (trigger.dataset[BOUND_DATASET_KEY] === "true") {
      continue;
    }
    trigger.dataset[BOUND_DATASET_KEY] = "true";
    if (logger?.enabled) {
      logger("trigger", "bound", trigger);
    }

    const handleClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const metadata = extractTriggerMetadata(trigger);
      if (logger?.enabled) {
        logger("trigger", "click", metadata);
      }
      if (metadata.board) {
        target.setBoard(metadata.board);
      }
      target.open(trigger, metadata);
    };

    trigger.addEventListener("click", handleClick, { passive: false });
  }
}

let triggerScanInterval: ReturnType<typeof setInterval> | null = null;

export function startTriggerScanning(
  target: TriggerTarget,
  logger?: Logger
): void {
  if (triggerScanInterval) {
    return;
  }
  triggerScanInterval = setInterval(() => bindTriggers(target, logger), 1000);
  bindTriggers(target, logger);
}

export function stopTriggerScanning(): void {
  if (triggerScanInterval) {
    clearInterval(triggerScanInterval);
    triggerScanInterval = null;
  }
}
