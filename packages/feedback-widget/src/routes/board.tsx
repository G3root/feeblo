import { createAsync, useParams, useSubmission } from "@solidjs/router";
import { createMemo, Show } from "solid-js";
import { FeedbackForm } from "../components/feedback-form";
import { Button } from "../components/ui/button";
import { Icon } from "../components/ui/icon";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { createFeedBackAction, fetchBoards } from "../lib/api";
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
  const submission = useSubmission(createFeedBackAction);

  return (
    <Show
      fallback={<FeedbackForm.Success />}
      when={submission.result?.ok !== true}
    >
      <form
        action={createFeedBackAction}
        class="flex h-full flex-col p-6"
        method="post"
      >
        <FeedbackForm.Header board={props.board} />
        <FeedbackForm.Fields>
          <Input
            name="title"
            placeholder="Share your product feedback!"
            required
          />
          <Textarea
            name="content"
            placeholder="Help us understand what value this feature would bring to your team or workflow"
          />
        </FeedbackForm.Fields>
        <input name="boardId" type="hidden" value={props.board.id} />
        <input name="boardName" type="hidden" value={props.board.name} />
        {submission.result?.ok === false && (
          <p class="text-destructive text-sm">{submission.result.message}</p>
        )}
        {submission.error && (
          <p class="text-destructive text-sm">
            Something went wrong. Please try again.
          </p>
        )}
        <FeedbackForm.Actions>
          <FeedbackForm.BackButton />
          <FeedbackForm.ActionsSecondary>
            <Button disabled={submission.pending} type="submit">
              <Icon class="size-4" name="SentIcon" />
              {submission.pending ? "Creating..." : "Create a new post"}
            </Button>
          </FeedbackForm.ActionsSecondary>
        </FeedbackForm.Actions>
      </form>
    </Show>
  );
}
