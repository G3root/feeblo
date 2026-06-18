import { createMemo, createSignal, type JSX } from "solid-js";

import type { Board } from "../../lib/boards";
import { FeedbackFormContext, type FeedbackFormContextValue } from "./context";

export interface FeedbackFormProviderProps {
  board: Board;
  children: JSX.Element;
}

export function FeedbackFormProvider(props: FeedbackFormProviderProps) {
  const [title, setTitle] = createSignal("");
  const [details, setDetails] = createSignal("");
  const [submitted, setSubmitted] = createSignal(false);

  const canSubmit = createMemo(() => title().trim().length > 0);

  const value: FeedbackFormContextValue = {
    state: {
      get title() {
        return title();
      },
      get details() {
        return details();
      },
      get submitted() {
        return submitted();
      },
    },
    actions: {
      setTitle,
      setDetails,
      submit: () => {
        if (!canSubmit()) {
          return;
        }
        setSubmitted(true);
      },
      reset: () => {
        setTitle("");
        setDetails("");
        setSubmitted(false);
      },
    },
    meta: {
      get board() {
        return props.board;
      },
      get canSubmit() {
        return canSubmit();
      },
    },
  };

  return (
    <FeedbackFormContext.Provider value={value}>
      {props.children}
    </FeedbackFormContext.Provider>
  );
}
