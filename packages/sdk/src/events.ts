import { NAMESPACE } from "./constants";
import type { Logger } from "./debug";
import type {
  FeebloEventDetail,
  FeebloEventListener,
  FeebloEventMap,
  FeebloEventName,
} from "./types";
import { isBrowser } from "./utils";

export function emitWidgetEvent<K extends FeebloEventName>(
  type: K,
  data: FeebloEventMap[K],
  logger?: Logger
): void {
  if (logger?.enabled) {
    logger("event", type, data);
  }
  if (!isBrowser()) {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<FeebloEventDetail<K>>(type, {
      detail: { data, type, namespace: NAMESPACE },
    })
  );
}

export function subscribe<E extends FeebloEventName | "*">(
  event: E,
  callback: E extends "*"
    ? FeebloEventListener<FeebloEventName>
    : FeebloEventListener<Extract<FeebloEventName, E>>
): () => void {
  if (!isBrowser()) {
    return () => undefined;
  }

  const target = event as FeebloEventName | "*";
  const listener = callback as EventListener;

  if (target === "*") {
    const names = [
      "widgetReady",
      "widgetOpened",
      "feedbackSubmitted",
    ] as const satisfies readonly FeebloEventName[];
    for (const name of names) {
      window.addEventListener(name, listener);
    }
    return () => {
      for (const name of names) {
        window.removeEventListener(name, listener);
      }
    };
  }

  window.addEventListener(target, listener);
  return () => window.removeEventListener(target, listener);
}

export function unsubscribe<E extends FeebloEventName | "*">(
  event: E,
  callback: E extends "*"
    ? FeebloEventListener<FeebloEventName>
    : FeebloEventListener<Extract<FeebloEventName, E>>
): void {
  if (!isBrowser()) {
    return;
  }

  const target = event as FeebloEventName | "*";
  const listener = callback as EventListener;

  if (target === "*") {
    for (const name of [
      "widgetReady",
      "widgetOpened",
      "feedbackSubmitted",
    ] as const) {
      window.removeEventListener(name, listener);
    }
    return;
  }

  window.removeEventListener(target, listener);
}
