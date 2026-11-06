import { createSignal, onCleanup } from "solid-js";

import type { WidgetSuggestion } from "../../lib/api";
import {
  initialSuggestionSearchState,
  reduceSuggestionSearch,
  SUGGESTIONS_DEBOUNCE_MS,
  type SuggestionQuery,
  type SuggestionSearchEvent,
  type SuggestionSearchState,
} from "./suggestion-search";

export type SuggestionFetch = (
  input: SuggestionQuery,
  signal: AbortSignal
) => Promise<readonly WidgetSuggestion[]>;

export type SuggestionSearch = {
  /**
   * Reports the field's current value. `null` means "nothing worth asking".
   *
   * Every call supersedes the previous one: the pending timer is cleared and
   * the in-flight request aborted, so at most one request is ever outstanding.
   */
  readonly input: (query: SuggestionQuery | null) => void;
  readonly state: () => SuggestionSearchState;
};

/**
 * Drives `reduceSuggestionSearch` from Solid.
 *
 * The graph and every decision in it live in the reducer; this file is the
 * timer, the abort controller and the signal, which is all that is left. The
 * cleanup is registered against the calling owner, so a component that unmounts
 * mid-debounce or mid-request cancels both.
 */
export function createSuggestionSearch(
  fetch: SuggestionFetch
): SuggestionSearch {
  const [state, setState] = createSignal<SuggestionSearchState>(
    initialSuggestionSearchState
  );
  let controller: AbortController | undefined;
  let timer: number | undefined;

  const send = (event: SuggestionSearchEvent) => {
    setState((current) => reduceSuggestionSearch(current, event));
  };

  const stop = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
    controller?.abort();
    controller = undefined;
  };

  const input = (query: SuggestionQuery | null) => {
    // Abort before the reducer sees the event: the request is superseded either
    // way, and stopping it early is what keeps a burst of keystrokes to one
    // request instead of one request per keystroke.
    stop();
    send({ type: "INPUT", query });
    if (query === null) {
      return;
    }
    timer = window.setTimeout(() => {
      timer = undefined;
      const request = new AbortController();
      controller = request;
      send({ type: "DEBOUNCED" });
      fetch(query, request.signal)
        .then((suggestions) => {
          send({ type: "LOADED", suggestions });
        })
        .catch(() => {
          send({ type: "FAILED" });
        });
    }, SUGGESTIONS_DEBOUNCE_MS);
  };

  onCleanup(stop);

  return { input, state };
}
