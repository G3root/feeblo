import type { WidgetHelpArticle } from "../../lib/api";

/**
 * The lifecycle of the widget's "related documentation" panel, as a plain
 * reducer.
 *
 * It sits beside `suggestion-search.ts` instead of reusing that reducer because
 * the two graphs differ in more than their item type. This answer carries
 * `enabled`, which is a property of the deployment and the workspace, not of
 * the query, and it is terminal for the session: once the server says the
 * workspace has no public help center, every later keystroke has to leave that
 * value alone. The suggestion reducer's only durable state is the last result,
 * and its `INPUT null` transition is explicitly allowed to clear all of it —
 * folding this latch into that state would make a suggestion concern part of
 * the help-center contract and vice versa.
 *
 * The parts that do carry over are the ones that matter on screen:
 *
 * - **The last settled result stays visible while the next one is pending**, so
 *   the panel does not flash on every keystroke.
 * - **A result that arrives after the query changed is dropped.** `LOADED` and
 *   `FAILED` are only accepted from `loading`, so a superseded response has no
 *   transition to take.
 */

/** How long the title must sit still before the help-center lookup is worth making. */
export const HELP_ARTICLES_DEBOUNCE_MS = 450;

/** Below this many characters there is nothing worth asking about. */
export const HELP_ARTICLE_QUERY_MIN_LENGTH = 3;

export type HelpArticleSearchStatus =
  | "idle"
  | "debouncing"
  | "loading"
  | "ready"
  | "failed";

export type HelpArticleSearchState = {
  /** The last settled result. Carried across a newer query so the panel does not flash. */
  readonly articles: readonly WidgetHelpArticle[];
  /** False once a response said there is no help center. Terminal for the session. */
  readonly enabled: boolean;
  readonly status: HelpArticleSearchStatus;
};

export type HelpArticleSearchEvent =
  /** The field changed. `query` is null when there is nothing worth asking. */
  | { readonly query: string | null; readonly type: "INPUT" }
  /** The debounce elapsed; the driver has started the request. */
  | { readonly type: "DEBOUNCED" }
  | {
      readonly articles: readonly WidgetHelpArticle[];
      readonly enabled: boolean;
      readonly type: "LOADED";
    }
  | { readonly type: "FAILED" };

export const initialHelpArticleSearchState: HelpArticleSearchState = {
  articles: [],
  // Unknown until the server answers. Assuming "off" here would suppress the
  // request that would have told us otherwise.
  enabled: true,
  status: "idle",
};

/** True while the panel is waiting on a timer or a request. */
export const isHelpArticleSearchPending = (
  state: HelpArticleSearchState
): boolean => state.status === "debouncing" || state.status === "loading";

/**
 * The title, trimmed, when it is long enough to be worth asking about.
 *
 * The gate lives here rather than in the provider so the rule is a pure value a
 * test can check, and so the driver cannot arm a timer for a two-letter title.
 */
export const helpArticleQuery = (title: string): string | null => {
  const query = title.trim();

  return query.length < HELP_ARTICLE_QUERY_MIN_LENGTH ? null : query;
};

export const reduceHelpArticleSearch = (
  state: HelpArticleSearchState,
  event: HelpArticleSearchEvent
): HelpArticleSearchState => {
  // The latch is checked before every event rather than inside `INPUT`: once
  // the answer is "there is no help center", no later keystroke may re-open
  // the question, and no late settle may rewrite the answer.
  if (!state.enabled) {
    return state;
  }

  switch (event.type) {
    case "INPUT":
      // Nothing to ask about: results that answer a question the visitor is no
      // longer asking go, the one case where carrying them forward is wrong.
      if (event.query === null) {
        return state.status === "idle" && state.articles.length === 0
          ? state
          : { articles: [], enabled: true, status: "idle" };
      }

      return { articles: state.articles, enabled: true, status: "debouncing" };
    case "DEBOUNCED":
      return state.status === "debouncing"
        ? { articles: state.articles, enabled: true, status: "loading" }
        : state;
    // The guard is the staleness check: a request whose query was superseded
    // left the state in `debouncing`, so its answer has nowhere to land.
    case "LOADED":
      return state.status === "loading"
        ? {
            // A disabled answer is the whole answer: anything else the payload
            // carries is not documentation this workspace publishes.
            articles: event.enabled ? event.articles : [],
            enabled: event.enabled,
            status: "ready",
          }
        : state;
    // A failure clears the panel: showing the previous query's results under a
    // query the server just refused would look like an answer.
    case "FAILED":
      return state.status === "loading"
        ? { articles: [], enabled: true, status: "failed" }
        : state;
  }
};
