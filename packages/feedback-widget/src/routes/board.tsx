import { createAsync, useParams } from "@solidjs/router";
import { createMemo, Show } from "solid-js";
import { FeedbackForm, useFeedbackForm } from "../components/feedback-form";
import { fetchBoards } from "../lib/api";

export function BoardDetailComponent() {
  const params = useParams();
  const boards = createAsync(() => fetchBoards());
  const board = createMemo(() =>
    boards()?.find((b) => b.id === params.boardId)
  );

  return (
    <Show fallback={<FeedbackForm.NotFound />} keyed when={board()}>
      {(board) => (
        <FeedbackForm.Provider board={board}>
          <FeedbackFormView />
        </FeedbackForm.Provider>
      )}
    </Show>
  );
}

export default BoardDetailComponent;

function FeedbackFormView() {
  const form = useFeedbackForm();

  return (
    <Show
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
      when={form.state.submitted}
    >
      <FeedbackForm.Success />
    </Show>
  );
}
