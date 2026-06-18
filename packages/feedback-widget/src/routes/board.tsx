import { useParams } from "@solidjs/router";
import { createMemo, Show } from "solid-js";
import { FeedbackForm, useFeedbackForm } from "../components/feedback-form";
import { getBoard } from "../lib/boards";

export function BoardDetailComponent() {
  const params = useParams();
  const board = createMemo(() => getBoard(params.boardId ?? ""));

  return (
    <Show when={board()} fallback={<FeedbackForm.NotFound />} keyed>
      {(board) => (
        <FeedbackForm.Provider board={board}>
          <FeedbackFormView />
        </FeedbackForm.Provider>
      )}
    </Show>
  );
}

function FeedbackFormView() {
  const form = useFeedbackForm();

  return (
    <Show
      when={form.state.submitted}
      fallback={
        <FeedbackForm.Frame>
          <FeedbackForm.Header />
          <FeedbackForm.Fields>
            <FeedbackForm.TitleField />
            <FeedbackForm.DetailsField />
          </FeedbackForm.Fields>
          <FeedbackForm.Actions>
            <FeedbackForm.BackButton />
            <FeedbackForm.ActionsSecondary>
              <FeedbackForm.SubmitButton />
            </FeedbackForm.ActionsSecondary>
          </FeedbackForm.Actions>
        </FeedbackForm.Frame>
      }
    >
      <FeedbackForm.Success />
    </Show>
  );
}
