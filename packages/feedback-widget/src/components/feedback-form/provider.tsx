import { useMemo, useState } from "react";

import type { Board } from "../../lib/boards";
import { FeedbackFormContext, type FeedbackFormContextValue } from "./context";

export interface FeedbackFormProviderProps {
  board: Board;
  children: React.ReactNode;
}

export function FeedbackFormProvider({
  board,
  children,
}: FeedbackFormProviderProps) {
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const canSubmit = useMemo(() => title.trim().length > 0, [title]);

  const value = useMemo<FeedbackFormContextValue>(
    () => ({
      state: { title, details, submitted },
      actions: {
        setTitle,
        setDetails,
        submit: () => {
          if (!canSubmit) {
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
      meta: { board, canSubmit },
    }),
    [board, canSubmit, details, submitted, title]
  );

  return <FeedbackFormContext value={value}>{children}</FeedbackFormContext>;
}
