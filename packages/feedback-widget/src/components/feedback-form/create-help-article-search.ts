import { createSignal, onCleanup, untrack } from "solid-js";

import type { WidgetHelpArticles } from "../../lib/api";
import {
  helpArticleQuery,
  HELP_ARTICLES_DEBOUNCE_MS,
  initialHelpArticleSearchState,
  reduceHelpArticleSearch,
  type HelpArticleSearchEvent,
  type HelpArticleSearchState,
} from "./help-article-search";

export type HelpArticleFetch = (
  query: string,
  signal: AbortSignal
) => Promise<WidgetHelpArticles>;

export type HelpArticleSearch = {
  /**
   * Reports the title field's current value. The trimming and the minimum
   * length are applied here, so "nothing worth asking" never reaches a timer.
   *
   * Every call supersedes the previous one: the pending timer is cleared and
   * the in-flight request aborted, so at most one request is ever outstanding.
   * Once the server has said the workspace has no help center, this is a no-op.
   */
  readonly input: (title: string) => void;
  readonly state: () => HelpArticleSearchState;
};

/**
 * Drives `reduceHelpArticleSearch` from Solid.
 *
 * The graph and every decision in it live in the reducer; this file is the
 * timer, the abort controller and the signal, which is all that is left. The
 * cleanup is registered against the calling owner, so a component that unmounts
 * mid-debounce or mid-request cancels both.
 */
export function createHelpArticleSearch(
  fetch: HelpArticleFetch
): HelpArticleSearch {
  const [state, setState] = createSignal<HelpArticleSearchState>(
    initialHelpArticleSearchState
  );

  let controller: AbortController | undefined;
  let timer: number | undefined;

  const send = (event: HelpArticleSearchEvent) => {
    setState((current) => reduceHelpArticleSearch(current, event));
  };

  const stop = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }

    controller?.abort();
    controller = undefined;
  };

  const input = (title: string) => {
    // The latch, at the only place a request can start. The reducer enforces it
    // too, but returning here means a disabled workspace does not churn the
    // signal, clear the panel, or arm a timer on every keystroke.
    //
    // Untracked on purpose: `input` is normally called from an effect that
    // reports the title, and a tracked read here would subscribe that effect to
    // the state this function writes — an effect that re-arms itself forever.
    if (!untrack(state).enabled) {
      return;
    }

    // Abort before the reducer sees the event: the request is superseded either
    // way, and stopping it early is what keeps a burst of keystrokes to one
    // request instead of one request per keystroke.
    stop();
    const query = helpArticleQuery(title);
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
        .then((response) => {
          // The reducer drops a late answer only while it is still
          // `debouncing`; by the time a superseded request settles, the next
          // one can already be `loading`, so the abort check is what keeps an
          // old outcome from landing on the new query.
          if (request.signal.aborted) {
            return;
          }

          send({
            articles: response.articles,
            enabled: response.enabled,
            type: "LOADED",
          });
        })
        .catch(() => {
          if (request.signal.aborted) {
            return;
          }

          send({ type: "FAILED" });
        });
    }, HELP_ARTICLES_DEBOUNCE_MS);
  };

  onCleanup(stop);

  return { input, state };
}
