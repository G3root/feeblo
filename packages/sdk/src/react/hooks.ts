import * as React from "react";

import { subscribe } from "../events";
import type { FeebloEventListener, FeebloEventName } from "../types";
import { useFeebloContext } from "./context";

// ---------------------------------------------------------------------------
// useFeeblo — main accessor
// ---------------------------------------------------------------------------

export function useFeeblo() {
  return useFeebloContext();
}

// ---------------------------------------------------------------------------
// useFeebloEvent — subscribe to widget events with stable handler refs
// (advanced-event-handler-refs: store handler in ref so effect deps stay primitive)
// ---------------------------------------------------------------------------

export function useFeebloEvent<K extends FeebloEventName>(
  event: K,
  handler: FeebloEventListener<K>
): void;

export function useFeebloEvent(
  event: "*",
  handler: FeebloEventListener<FeebloEventName>
): void;

export function useFeebloEvent<K extends FeebloEventName | "*">(
  event: K,
  handler: K extends "*"
    ? FeebloEventListener<FeebloEventName>
    : FeebloEventListener<Extract<FeebloEventName, K>>
): void {
  const handlerRef = React.useRef(handler);
  React.useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  React.useEffect(() => {
    // Wrap so the current ref is always invoked — stable subscription
    // SAFETY: EventTarget accepts this listener shape for the custom event wrapper.
    const wrapped = ((event: CustomEvent<unknown>) => {
      const invoke =
        // SAFETY: subscribe only invokes this listener with the matching custom event.
        handlerRef.current as (event: CustomEvent<unknown>) => void;
      invoke(event);
    }) as EventListener;

    // SAFETY: K is constrained to the event names accepted by subscribe.
    const target = event as FeebloEventName | "*";
    // SAFETY: this listener handles every event detail represented by the wildcard overload.
    const callback = wrapped as FeebloEventListener<FeebloEventName>;
    return subscribe(target, callback);
  }, [event]);
}

// ---------------------------------------------------------------------------
// useFeebloIsReady / useFeebloIsOpen — derived selectors
// (rerender-derived-state: subscribe to booleans, not raw widget object)
// ---------------------------------------------------------------------------

export function useFeebloIsReady(): boolean {
  return useFeebloContext().isReady;
}

export function useFeebloIsOpen(): boolean {
  return useFeebloContext().isOpen;
}

// ---------------------------------------------------------------------------
// useFeebloWidget — direct widget handle (nullable)
// ---------------------------------------------------------------------------

export function useFeebloWidget() {
  return useFeebloContext().widget;
}

// ---------------------------------------------------------------------------
// useFeebloFeedback — convenience for the most common subscription
// ---------------------------------------------------------------------------

export function useOnFeedbackSubmitted(
  handler: FeebloEventListener<"feedbackSubmitted">
): void {
  useFeebloEvent("feedbackSubmitted", handler);
}
