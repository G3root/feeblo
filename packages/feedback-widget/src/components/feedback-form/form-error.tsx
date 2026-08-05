import { useFeedbackForm } from "./context";

export function FeedbackFormError() {
  const { state } = useFeedbackForm();

  return (
    <>
      {state.submission.result?.ok === false && (
        <p class="text-destructive text-sm">
          {state.submission.result.message}
        </p>
      )}
      {state.submission.error && (
        <p class="text-destructive text-sm">
          Something went wrong. Please try again.
        </p>
      )}
    </>
  );
}
