import { createAsync, useParams } from "@solidjs/router";
import { createMemo, Show } from "solid-js";

import { FeedbackForm, useFeedbackForm } from "../components/feedback-form";
import { fetchBoards } from "../lib/api";
import type { Board } from "../lib/boards";

export function BoardDetailComponent() {
  const params = useParams();
  const boards = createAsync(() => fetchBoards());
  const board = createMemo(() =>
    boards()?.find((b) => b.id === params.boardId)
  );

  return (
    <Show fallback={<FeedbackForm.NotFound />} keyed when={board()}>
      {(board) => <FeedbackFormView board={board} />}
    </Show>
  );
}

export default BoardDetailComponent;

function FeedbackFormView(props: { board: Board }) {
  return (
    <FeedbackForm.Provider board={props.board}>
      <FeedbackFormViewInternal />
    </FeedbackForm.Provider>
  );
}

function FeedbackFormViewInternal() {
  const { state } = useFeedbackForm();

  return (
    <Show
      fallback={<FeedbackForm.Success />}
      when={state.submission.result?.ok !== true}
    >
      <FeedbackForm.Frame>
        <FeedbackForm.Header />
        <FeedbackForm.Fields>
          <FeedbackForm.TitleField />
          <FeedbackForm.ContentField />
          <FeedbackForm.Suggestions />
        </FeedbackForm.Fields>
        <FeedbackForm.Error />
        <FeedbackForm.Actions>
          <FeedbackForm.BackButton />
          <FeedbackForm.ActionsSecondary>
            <FeedbackForm.SubmitButton />
          </FeedbackForm.ActionsSecondary>
        </FeedbackForm.Actions>
      </FeedbackForm.Frame>
    </Show>
  );
}
