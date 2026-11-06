import type { WidgetSuggestion } from "../../lib/api";

/**
 * The lifecycle of the widget's "similar posts" panel, as a plain reducer.
 *
 * This is the same graph `apps/web` declares with XState, hand-rolled because
 * the widget is a Solid iframe bundle published to customers' pages: pulling in
 * an interpreter for one debounced fetch would be bundle weight on every page
 * that embeds the widget, and the machine's only caller here would be the
 * driver in `create-suggestion-search.ts`. The reducer below is pure, so the
 * graph is still one value a test can walk — the thing the effect it replaces
 * could not offer.
 *
 * The effect it replaces held the same lifecycle in four signals and a
 * `createEffect`: a `setTimeout`, an `AbortController`, an `isCurrent` flag,
 * and `setSuggestions`/`setSuggestionsPending` calls that each had to remember
 * which of the others it invalidated. Two rules were load-bearing and neither
 * was written down:
 *
 * - **The last settled result stays visible while the next one is pending.**
 *   Clearing on input made the panel flash on every keystroke; that is why
 *   `INPUT` and `DEBOUNCED` carry `suggestions` forward rather than emptying
 *   them.
 * - **A result that arrives after the query changed is dropped.** The
 *   `isCurrent` flag did that, and the guards below do it structurally: a
 *   `LOADED` or `FAILED` event is only accepted from `loading`, so once `INPUT`
 *   has moved the state to `debouncing` there is no transition for a late
 *   answer to take.
 */

/** How long the title must sit still before a suggestion request is worth making. */
export const SUGGESTIONS_DEBOUNCE_MS = 450;

/** Below this many characters there is nothing worth asking about. */
export const SUGGESTION_QUERY_MIN_LENGTH = 3;

export type SuggestionQuery = {
  readonly boardId: string;
  readonly content: string;
  readonly title: string;
};

export type SuggestionSearchStatus =
  | "idle"
  | "debouncing"
  | "loading"
  | "ready"
  | "failed";

export type SuggestionSearchState = {
  /** The last settled result. Carried across a newer query so the panel does not flash. */
  readonly suggestions: readonly WidgetSuggestion[];
  readonly status: SuggestionSearchStatus;
};

export type SuggestionSearchEvent =
  /** The field changed. `query` is null when there is nothing worth asking. */
  | { readonly query: SuggestionQuery | null; readonly type: "INPUT" }
  /** The debounce elapsed; the driver has started the request. */
  | { readonly type: "DEBOUNCED" }
  | {
      readonly suggestions: readonly WidgetSuggestion[];
      readonly type: "LOADED";
    }
  | { readonly type: "FAILED" };

export const initialSuggestionSearchState: SuggestionSearchState = {
  suggestions: [],
  status: "idle",
};

/** True while the panel is waiting on a timer or a request. */
export const isSuggestionSearchPending = (
  state: SuggestionSearchState
): boolean => state.status === "debouncing" || state.status === "loading";

export const reduceSuggestionSearch = (
  state: SuggestionSearchState,
  event: SuggestionSearchEvent
): SuggestionSearchState => {
  switch (event.type) {
    case "INPUT":
      // Nothing to ask about: the panel's results answer a question the user is
      // no longer asking, so they go — the one case where carrying them forward
      // would be wrong.
      if (event.query === null) {
        return state.status === "idle" && state.suggestions.length === 0
          ? state
          : { suggestions: [], status: "idle" };
      }
      return { suggestions: state.suggestions, status: "debouncing" };
    case "DEBOUNCED":
      return state.status === "debouncing"
        ? { suggestions: state.suggestions, status: "loading" }
        : state;
    // The guard is the staleness check: a request whose query was superseded
    // left the state in `debouncing`, so its answer has nowhere to land.
    case "LOADED":
      return state.status === "loading"
        ? { suggestions: event.suggestions, status: "ready" }
        : state;
    // A failure is the one outcome that clears the panel: showing results from
    // a query the server just refused would look like an answer.
    case "FAILED":
      return state.status === "loading"
        ? { suggestions: [], status: "failed" }
        : state;
  }
};
