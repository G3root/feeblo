import type { Comment } from "@feeblo/domain/comments/schema";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import type { ReactNode } from "react";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemTitle,
} from "~/components/ui/item";
import { Skeleton } from "~/components/ui/skeleton";
import { commentCollection, commentReactionCollection } from "~/lib/collections";
import {
  CommentReactionSection,
  type CommentReaction,
} from "./comment-reaction-section";
import { toRenderableRichTextHtml } from "./post-editor-utils";

const READONLY_RICH_TEXT_CLASS =
  "prose prose-sm max-w-none text-foreground prose-headings:mb-2 prose-headings:mt-4 prose-headings:text-foreground prose-p:my-2 prose-p:text-foreground prose-strong:text-foreground prose-a:text-foreground prose-blockquote:text-muted-foreground prose-code:text-foreground prose-pre:bg-muted prose-img:my-3 prose-img:max-h-80 prose-img:rounded-lg prose-img:border prose-img:border-border/60";

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

type RenderCommentActionsArgs = {
  comment: Comment;
};

type PostCommentListProps = {
  emptyState?: ReactNode;
  organizationId: string;
  postId: string;
  renderCommentActions?: (args: RenderCommentActionsArgs) => ReactNode;
};

export function PostCommentList({
  emptyState = null,
  organizationId,
  postId,
  renderCommentActions,
}: PostCommentListProps) {
  const commentsQuery = useLiveQuery(
    (q) =>
      q
        .from({ comment: commentCollection })
        .where(({ comment }) =>
          and(
            eq(comment.organizationId, organizationId),
            eq(comment.postId, postId)
          )
        )
        .orderBy((comment) => comment.comment.createdAt, "desc"),
    [organizationId, postId]
  );

  const commentReactionsQuery = useLiveQuery(
    (q) =>
      q
        .from({ commentReaction: commentReactionCollection })
        .where(({ commentReaction }) =>
          and(
            eq(commentReaction.organizationId, organizationId),
            eq(commentReaction.postId, postId)
          )
        )
        .orderBy(
          (commentReaction) => commentReaction.commentReaction.commentId,
          "asc"
        )
        .orderBy(
          (commentReaction) => commentReaction.commentReaction.emoji,
          "asc"
        )
        .orderBy(
          (commentReaction) => commentReaction.commentReaction.createdAt,
          "asc"
        ),
    [organizationId, postId]
  );

  if (commentsQuery.isLoading || commentReactionsQuery.isLoading) {
    return <PostCommentListSkeleton />;
  }

  if (commentsQuery.isError || commentReactionsQuery.isError) {
    return (
      <p className="text-muted-foreground text-sm">
        Comments are unavailable right now.
      </p>
    );
  }

  const comments = (commentsQuery.data ?? []) as Comment[];
  const commentReactions = (commentReactionsQuery.data ?? []) as CommentReaction[];

  if (comments.length === 0) {
    return emptyState;
  }

  return (
    <ItemGroup>
      {comments.map((comment) => {
        const actions = renderCommentActions?.({ comment });

        return (
          <Item
            className="rounded-xl border-border/80 px-4 py-3"
            key={comment.id}
            variant="outline"
          >
            <ItemMedia variant="default">
              <Avatar size="sm">
                <AvatarFallback>{getInitials(comment.user.name)}</AvatarFallback>
              </Avatar>
            </ItemMedia>
            <ItemContent className="gap-2">
              <ItemHeader className="justify-start gap-2">
                <ItemTitle className="font-medium text-sm">
                  {comment.user.name}
                </ItemTitle>
                <span className="text-muted-foreground text-sm">
                  {formatRelativeTime(comment.createdAt)}
                </span>
              </ItemHeader>
              <ItemDescription className="line-clamp-none text-foreground">
                <div
                  className={READONLY_RICH_TEXT_CLASS}
                  dangerouslySetInnerHTML={{
                    __html: toRenderableRichTextHtml(comment.content),
                  }}
                />
              </ItemDescription>
              <CommentReactionSection
                commentId={comment.id}
                commentReactions={commentReactions}
                organizationId={organizationId}
                postId={postId}
              />
            </ItemContent>
            {actions ? <ItemActions className="self-start">{actions}</ItemActions> : null}
          </Item>
        );
      })}
    </ItemGroup>
  );
}

export function PostCommentListSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-xl" />
    </div>
  );
}

function formatRelativeTime(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Recently";
  }

  const diffMs = date.getTime() - Date.now();
  const diffSeconds = Math.round(diffMs / 1000);
  const diffMinutes = Math.round(diffMs / (1000 * 60));
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (Math.abs(diffSeconds) < 60) {
    return rtf.format(diffSeconds, "second");
  }
  if (Math.abs(diffMinutes) < 60) {
    return rtf.format(diffMinutes, "minute");
  }
  if (Math.abs(diffHours) < 24) {
    return rtf.format(diffHours, "hour");
  }
  return rtf.format(diffDays, "day");
}

function getInitials(name: string | null | undefined) {
  const normalized = name?.trim();

  if (!normalized) {
    return "??";
  }

  const segments = normalized.split(/\s+/).slice(0, 2);
  return segments.map((segment) => segment.charAt(0).toUpperCase()).join("");
}
