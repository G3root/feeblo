import { createAsync, useParams, useSubmission } from "@solidjs/router";
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { FeedbackForm } from "../components/feedback-form";
import { Button } from "../components/ui/button";
import { Icon } from "../components/ui/icon";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import {
  createFeedBackAction,
  fetchBoards,
  fetchSimilarFeedback,
} from "../lib/api";
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
  const [title, setTitle] = createSignal("");
  const [content, setContent] = createSignal("");
  const [similarityInput, setSimilarityInput] = createSignal<{
    boardId: string;
    text: string;
    title: string;
  }>();
  createEffect(() => {
    const next = {
      boardId: props.board.id,
      text: content(),
      title: title(),
    };
    const timeout = window.setTimeout(() => setSimilarityInput(next), 300);
    onCleanup(() => window.clearTimeout(timeout));
  });
  const [similar] = createResource(similarityInput, fetchSimilarFeedback);

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
            onInput={(event) => setTitle(event.currentTarget.value)}
            placeholder="Share your product feedback!"
            required
          />
          <Textarea
            name="content"
            onInput={(event) => setContent(event.currentTarget.value)}
            placeholder="Help us understand what value this feature would bring to your team or workflow"
          />
          <Show when={(similar()?.length ?? 0) > 0}>
            <div class="rounded-lg border bg-muted/40 p-3">
              <p class="font-medium text-sm">This may already exist</p>
              <p class="mb-2 text-muted-foreground text-xs">
                Check these requests before creating another post.
              </p>
              <ul class="space-y-2">
                <For each={similar()}>
                  {(candidate) => (
                    <li>
                      <p class="font-medium text-sm">{candidate.title}</p>
                      <p class="line-clamp-2 text-muted-foreground text-xs">
                        {candidate.excerpt}
                      </p>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </Show>
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
