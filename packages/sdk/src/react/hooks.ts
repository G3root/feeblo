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
  handler: FeebloEventListener<K>,
): void;

export function useFeebloEvent(
  event: "*",
  handler: FeebloEventListener<FeebloEventName>,
): void;

export function useFeebloEvent<K extends FeebloEventName | "*">(
  event: K,
  handler: K extends "*"
    ? FeebloEventListener<FeebloEventName>
    : FeebloEventListener<Extract<FeebloEventName, K>>,
): void {
  const handlerRef = React.useRef(handler);
  // Keep ref in sync without triggering resubscribe
  handlerRef.current = handler as unknown as typeof handlerRef.current;

  React.useEffect(() => {
    // Wrap so the current ref is always invoked — stable subscription
    const wrapped = ((e: CustomEvent<unknown>) => {
      // SAFETY: the event system guarantees the detail shape
      (handlerRef.current as (e: CustomEvent<unknown>) => void)(e);
    }) as EventListener;

    const target = event as FeebloEventName | "*";
    // subscribe returns an unsubscribe function; use that for cleanup
    const off = subscribe(
      target as FeebloEventName,
      wrapped as unknown as FeebloEventListener<FeebloEventName>,
    );

    // The subscribe overload for "*" expects the same handler shape; the cast
    // above covers both branches. subscribe handles "*" internally by
    // iterating EVENT_NAMES.
    return off;
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
  handler: FeebloEventListener<"feedbackSubmitted">,
): void {
  useFeebloEvent("feedbackSubmitted", handler);
}
