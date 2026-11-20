import { useSubmission } from "@solidjs/router";
import { createEffect, createSignal, type JSX } from "solid-js";

import {
  createFeedBackAction,
  fetchSuggestions,
  requestHelpArticles,
} from "../../lib/api";
import type { Board } from "../../lib/boards";
import { FeedbackFormContext, type FeedbackFormContextValue } from "./context";
import { createHelpArticleSearch } from "./create-help-article-search";
import { createSuggestionSearch } from "./create-suggestion-search";
import { isHelpArticleSearchPending } from "./help-article-search";
import {
  isSuggestionSearchPending,
  SUGGESTION_QUERY_MIN_LENGTH,
} from "./suggestion-search";

/**
 * The only place that knows how the feedback form state is managed:
 * title/content signals, the two searches, and the router submission.
 * Consumers only see the context interface.
 *
 * Neither search lifecycle is in this file. Each is a reducer holding the
 * graph plus a driver holding the timer and the abort. What is left here is
 * the one line that reports the field to each.
 */
export function FeedbackFormProvider(props: {
  board: Board;
  children: JSX.Element;
}) {
  const submission = useSubmission(createFeedBackAction);
  const [title, setTitle] = createSignal("");
  const [content, setContent] = createSignal("");
  const suggestionSearch = createSuggestionSearch(fetchSuggestions);

  const helpArticleSearch = createHelpArticleSearch((query, signal) =>
    requestHelpArticles(
      { organizationId: props.board.organizationId, query },
      signal
    )
  );

  createEffect(() => {
    // Separate effect from the suggestion search on purpose: that one also
    // reads the content field, and sharing it would reset this debounce (and
    // abort its request) on every content keystroke.
    helpArticleSearch.input(title());
  });

  createEffect(() => {
    const nextTitle = title().trim();
    const nextContent = content();
    // Reporting the field is the only thing this effect does; `input` decides
    // whether that arms a debounce, supersedes an in-flight request, or clears
    // the panel.
    suggestionSearch.input(
      nextTitle.length < SUGGESTION_QUERY_MIN_LENGTH
        ? null
        : { boardId: props.board.id, content: nextContent, title: nextTitle }
    );
  });

  const value: FeedbackFormContextValue = {
    state: {
      title,
      content,
      helpArticles: () => helpArticleSearch.state().articles,
      helpArticlesEnabled: () => helpArticleSearch.state().enabled,
      helpArticlesPending: () =>
        isHelpArticleSearchPending(helpArticleSearch.state()),
      suggestions: () => suggestionSearch.state().suggestions,
      suggestionsPending: () =>
        isSuggestionSearchPending(suggestionSearch.state()),
      submission,
    },
    actions: {
      setTitle,
      setContent,
    },
    meta: {
      board: props.board,
    },
  };

  return (
    <FeedbackFormContext.Provider value={value}>
      {props.children}
    </FeedbackFormContext.Provider>
  );
}
