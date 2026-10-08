import { createAsync, useParams } from "@solidjs/router";
import { Show, Suspense } from "solid-js";

import { FeedbackForm, useFeedbackForm } from "../components/feedback-form";
import { FeedbackFormSkeleton } from "../components/feedback-form/skeleton";
import { ViewTransition } from "../components/shell/view-transition";
import { fetchBoards } from "../lib/api";

export function BoardDetailComponent() {
  return (
    <ViewTransition kind="push">
      <Suspense fallback={<FeedbackFormSkeleton />}>
        <BoardDetailScreen />
      </Suspense>
    </ViewTransition>
  );
}

function BoardDetailScreen() {
  const params = useParams();
  const boards = createAsync(() => fetchBoards());

  return (
    <Show
      fallback={<FeedbackForm.NotFound />}
      keyed
      when={boards()?.find(
        (board) => board.id === params.boardId || board.slug === params.boardId
      )}
    >
      {(board) => (
        <FeedbackForm.Provider board={board}>
          <FeedbackFormScreen />
        </FeedbackForm.Provider>
      )}
    </Show>
  );
}

function FeedbackFormScreen() {
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
        <FeedbackForm.Actions>
          <FeedbackForm.Error />
          <FeedbackForm.SubmitButton />
        </FeedbackForm.Actions>
      </FeedbackForm.Frame>
    </Show>
  );
}

export default BoardDetailComponent;
