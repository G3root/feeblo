import {
  Feeblo,
  type FeebloEventDetail,
  type FeebloEventListener,
  type FeebloEventName,
} from "@feeblo/sdk";
import { useEffect, useRef } from "react";

/** Handler shape once the event name has been widened past a specific `K`. */
type AnyFeebloEventHandler = (
  event: CustomEvent<FeebloEventDetail<FeebloEventName>>
) => void;

/**
 * Subscribe to a typed widget event for the lifetime of the component.
 *
 * The handler may be an inline closure: it is read through a ref, so updating
 * it never resubscribes and the subscription always invokes the latest one.
 * Pass `"*"` to observe every widget event.
 *
 * @example
 * useFeebloEvent("feedbackSubmitted", (event) => {
 *   analytics.track("feedback", event.detail.data);
 * });
 */
export function useFeebloEvent<K extends FeebloEventName>(
  event: K,
  handler: (event: CustomEvent<FeebloEventDetail<K>>) => void
): void;
export function useFeebloEvent(
  event: "*",
  handler: AnyFeebloEventHandler
): void;
export function useFeebloEvent(
  event: FeebloEventName | "*",
  handler: AnyFeebloEventHandler
): void {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    const forward: FeebloEventListener<FeebloEventName> = (nativeEvent) => {
      handlerRef.current(nativeEvent);
    };
    if (event === "*") {
      return Feeblo.on("*", forward);
    }
    return Feeblo.on(event, forward);
  }, [event]);
}
