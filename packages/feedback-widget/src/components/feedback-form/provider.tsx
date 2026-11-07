import { useSubmission } from "@solidjs/router";
import { createEffect, createSignal, type JSX } from "solid-js";

import { createFeedBackAction, fetchSuggestions } from "../../lib/api";
import type { Board } from "../../lib/boards";
import { FeedbackFormContext, type FeedbackFormContextValue } from "./context";
import { createSuggestionSearch } from "./create-suggestion-search";
import {
  isSuggestionSearchPending,
  SUGGESTION_QUERY_MIN_LENGTH,
} from "./suggestion-search";

/**
 * The only place that knows how the feedback form state is managed:
 * title/content signals, the suggestion search, and the router submission.
 * Consumers only see the context interface.
 *
 * The suggestion lifecycle is not in this file. It used to be a `createEffect`
 * holding a timer, an `AbortController` and an `isCurrent` flag; it is now
 * `suggestion-search.ts` (the graph, as a pure reducer) and
 * `create-suggestion-search.ts` (the timer and the abort). What is left here is
 * the one line that reports the field.
 */
export function FeedbackFormProvider(props: {
  board: Board;
  children: JSX.Element;
}) {
  const submission = useSubmission(createFeedBackAction);
  const [title, setTitle] = createSignal("");
  const [content, setContent] = createSignal("");
  const suggestionSearch = createSuggestionSearch(fetchSuggestions);

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
