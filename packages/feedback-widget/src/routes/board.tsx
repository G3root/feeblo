import { createAsync, useParams, useSubmission } from "@solidjs/router";
import {
  createEffect,
  createMemo,
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
  fetchSuggestions,
  type WidgetSuggestion,
} from "../lib/api";
import type { Board } from "../lib/boards";

const SUGGESTIONS_DEBOUNCE_MS = 450;

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
  const [suggestions, setSuggestions] = createSignal<WidgetSuggestion[]>([]);
  const [suggestionsPending, setSuggestionsPending] = createSignal(false);

  createEffect(() => {
    const nextTitle = title().trim();
    const nextContent = content();
    if (nextTitle.length < 3) {
      setSuggestions([]);
      setSuggestionsPending(false);
      return;
    }

    // Keep the previous results visible while the input settles and the next
    // request is in flight. Clearing here made the suggestion panel flash on
    // every keystroke.
    setSuggestionsPending(true);
    const controller = new AbortController();
    let isCurrent = true;
    const timer = window.setTimeout(() => {
      fetchSuggestions(
        {
          boardId: props.board.id,
          content: nextContent,
          title: nextTitle,
        },
        controller.signal
      )
        .then((nextSuggestions) => {
          if (isCurrent) {
            setSuggestions(nextSuggestions);
          }
        })
        .catch(() => {
          if (isCurrent && !controller.signal.aborted) {
            setSuggestions([]);
          }
        })
        .finally(() => {
          if (isCurrent) {
            setSuggestionsPending(false);
          }
        });
    }, SUGGESTIONS_DEBOUNCE_MS);
    onCleanup(() => {
      isCurrent = false;
      window.clearTimeout(timer);
      controller.abort();
    });
  });

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
          <Show when={suggestions().length > 0}>
            <section
              aria-label="Similar posts"
              aria-busy={suggestionsPending()}
              class="overflow-hidden rounded-lg border bg-muted/40"
            >
              <div class="border-b px-3 py-2">
                <p class="font-medium text-sm">
                  {suggestionsPending() ? "Updating similar posts" : "Similar posts"}
                </p>
                <p class="text-muted-foreground text-xs">
                  Your idea may already have been shared.
                </p>
              </div>
              <For each={suggestions()}>
                {(post) => (
                  <div class="flex flex-col gap-0.5 border-b px-3 py-2.5 last:border-b-0">
                    <span class="font-medium text-sm">{post.title}</span>
                    <Show when={post.excerpt}>
                      <span class="line-clamp-1 text-muted-foreground text-xs">
                        {post.excerpt}
                      </span>
                    </Show>
                  </div>
                )}
              </For>
            </section>
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
