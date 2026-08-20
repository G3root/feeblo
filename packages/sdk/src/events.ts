import { EVENT_NAMES, NAMESPACE } from "./constants";
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

export function subscribe(
  event: FeebloEventName | "*",
  callback: FeebloEventListener<FeebloEventName>
): () => void;
export function subscribe<E extends FeebloEventName | "*">(
  event: E,
  callback: E extends "*"
    ? FeebloEventListener<FeebloEventName>
    : FeebloEventListener<Extract<FeebloEventName, E>>
): () => void;
export function subscribe(
  event: FeebloEventName | "*",
  callback: FeebloEventListener<FeebloEventName>
): () => void {
  if (!isBrowser()) {
    return () => undefined;
  }

  // SAFETY: The upstream source guarantees one of these values; the cast bridges an untyped API.
  const target = event as FeebloEventName | "*";
  // SAFETY: The upstream contract guarantees this value here.
  const listener = callback as EventListener;

  if (target === "*") {
    for (const name of EVENT_NAMES) {
      window.addEventListener(name, listener);
    }
    return () => {
      for (const name of EVENT_NAMES) {
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

  // SAFETY: The upstream source guarantees one of these values; the cast bridges an untyped API.
  // SAFETY: The upstream contract guarantees this value here.
  const target = event as FeebloEventName | "*";
  // SAFETY: The upstream contract guarantees this value here.
  const listener = callback as EventListener;

  if (target === "*") {
    for (const name of EVENT_NAMES) {
      window.removeEventListener(name, listener);
    }
    return;
  }

  window.removeEventListener(target, listener);
}
