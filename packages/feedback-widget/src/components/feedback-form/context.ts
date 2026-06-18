import { createContext, use } from "react";

import type { Board } from "../../lib/boards";

export interface FeedbackFormState {
  details: string;
  submitted: boolean;
  title: string;
}

export interface FeedbackFormActions {
  reset: () => void;
  setDetails: (value: string) => void;
  setTitle: (value: string) => void;
  submit: () => void;
}

export interface FeedbackFormMeta {
  board: Board;
  canSubmit: boolean;
}

export interface FeedbackFormContextValue {
  actions: FeedbackFormActions;
  meta: FeedbackFormMeta;
  state: FeedbackFormState;
}

export const FeedbackFormContext =
  createContext<FeedbackFormContextValue | null>(null);

export function useFeedbackForm(): FeedbackFormContextValue {
  const value = use(FeedbackFormContext);
  if (!value) {
    throw new Error(
      "useFeedbackForm must be used within a FeedbackForm.Provider"
    );
  }
  return value;
}
