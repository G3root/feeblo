import { useSubmission } from "@solidjs/router";
import { createEffect, createSignal, type JSX, onCleanup } from "solid-js";

import {
  createFeedBackAction,
  fetchSuggestions,
  type WidgetSuggestion,
} from "../../lib/api";
import type { Board } from "../../lib/boards";
import { FeedbackFormContext, type FeedbackFormContextValue } from "./context";

const SUGGESTIONS_DEBOUNCE_MS = 450;

/**
 * The only place that knows how the feedback form state is managed:
 * title/content signals, debounced suggestion fetching, and the router
 * submission. Consumers only see the context interface.
 */
export function FeedbackFormProvider(props: {
  board: Board;
  children: JSX.Element;
}) {
  const submission = useSubmission(createFeedBackAction);
  const [title, setTitle] = createSignal("");
  const [content, setContent] = createSignal("");
  const [suggestions, setSuggestions] = createSignal<WidgetSuggestion[]>([]);
  const [suggestionsPending, setSuggestionsPending] = createSignal(false);

  createEffect(() => {
    const nextTitle = title().trim();
    const nextContent = content();
    if (nextTitle.length < 3) {
      setSuggestions([]);
      setSuggestionsPending(false);
      return;
    }

    // Keep the previous results visible while the input settles and the next
    // request is in flight. Clearing here made the suggestion panel flash on
    // every keystroke.
    setSuggestionsPending(true);
    const controller = new AbortController();
    let isCurrent = true;
    const timer = window.setTimeout(() => {
      fetchSuggestions(
        {
          boardId: props.board.id,
          content: nextContent,
          title: nextTitle,
        },
        controller.signal
      )
        .then((nextSuggestions) => {
          if (isCurrent) {
            setSuggestions(nextSuggestions);
          }
        })
        .catch(() => {
          if (isCurrent && !controller.signal.aborted) {
            setSuggestions([]);
          }
        })
        .finally(() => {
          if (isCurrent) {
            setSuggestionsPending(false);
          }
        });
    }, SUGGESTIONS_DEBOUNCE_MS);
    onCleanup(() => {
      isCurrent = false;
      window.clearTimeout(timer);
      controller.abort();
    });
  });

  const value: FeedbackFormContextValue = {
    state: {
      title,
      content,
      suggestions,
      suggestionsPending,
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
