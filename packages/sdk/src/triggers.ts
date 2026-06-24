import { FEEDBACK_ATTRIBUTE } from "./constants";
import type { Logger } from "./debug";

const METADATA_KEY_REGEX = /^feeblo([A-Z]\w*)$/;

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

export function extractTriggerMetadata(
  element: HTMLElement
): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const key of Object.keys(element.dataset)) {
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
    if (trigger.dataset.feebloBound === "true") {
      continue;
    }
    trigger.dataset.feebloBound = "true";
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
