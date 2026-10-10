import { useFeedbackForm } from "./context";

export function FeedbackFormError() {
  const { state } = useFeedbackForm();

  return (
    <>
      {state.submission.result?.ok === false && (
        <p class="text-destructive text-sm" role="alert">
          {state.submission.result.message}
        </p>
      )}
      {state.submission.error && (
        <p class="text-destructive text-sm" role="alert">
          Something went wrong. Please try again.
        </p>
      )}
    </>
  );
}
