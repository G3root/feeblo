import { and, eq, useLiveQuery } from "@tanstack/solid-db";
import { ErrorBoundary, For, Match, Suspense, Switch } from "solid-js";
import { commentCollection } from "src/lib/collection";
import { useSite } from "src/providers/site-provider";
import { CommentItem } from "./comment-item";
import { CommentsEmptyState } from "./comments-empty-state";
import { CommentsHeader } from "./comments-header";

interface CommentsSectionProps {
  postId: string;
}

export function CommentsSection(props: CommentsSectionProps) {
  const site = useSite();

  const comments = useLiveQuery((q) =>
    q
      .from({ comment: commentCollection })
      .where(({ comment }) =>
        and(
          eq(comment.postId, props.postId),
          eq(comment.organizationId, site.organizationId)
        )
      )
  );

  return (
    <ErrorBoundary fallback={<div>Error</div>}>
      <Suspense fallback={<div>Loading...</div>}>
        <Switch>
          <Match when={comments.isReady}>
            <div class="flex flex-col gap-4">
              <CommentsHeader totalComments={comments().length} />
              <div>
                <For each={comments()} fallback={<CommentsEmptyState />}>
                  {(comment) => <CommentItem comment={comment} />}
                </For>
              </div>
            </div>
          </Match>
        </Switch>
      </Suspense>
    </ErrorBoundary>
  );
}
