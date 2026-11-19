import type { useSubmission } from "@solidjs/router";
import { type Accessor, createContext, useContext } from "solid-js";

import type {
  FeedbackResult,
  WidgetHelpArticle,
  WidgetSuggestion,
} from "../../lib/api";
import type { Board } from "../../lib/boards";

type FeedbackFormSubmission = ReturnType<
  typeof useSubmission<[FormData], FeedbackResult, [FormData]>
>;

export interface FeedbackFormState {
  content: Accessor<string>;
  helpArticles: Accessor<readonly WidgetHelpArticle[]>;
  /** False once the deployment or workspace has no help center to deflect to. */
  helpArticlesEnabled: Accessor<boolean>;
  helpArticlesPending: Accessor<boolean>;
  submission: FeedbackFormSubmission;
  suggestions: Accessor<readonly WidgetSuggestion[]>;
  suggestionsPending: Accessor<boolean>;
  title: Accessor<string>;
}

export interface FeedbackFormActions {
  setContent: (value: string) => void;
  setTitle: (value: string) => void;
}

export interface FeedbackFormMeta {
  board: Board;
}

/**
 * Generic contract any provider can implement: UI components only depend on
 * this interface, never on how state is managed (signals, router submissions,
 * server sync, ...).
 */
export interface FeedbackFormContextValue {
  actions: FeedbackFormActions;
  meta: FeedbackFormMeta;
  state: FeedbackFormState;
}

export const FeedbackFormContext = createContext<FeedbackFormContextValue>();

export function useFeedbackForm(): FeedbackFormContextValue {
  const value = useContext(FeedbackFormContext);

  if (!value) {
    throw new Error(
      "useFeedbackForm must be used within a FeedbackForm.Provider"
    );
  }

  return value;
}
