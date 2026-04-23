import type { Comment } from "@feeblo/domain/comments/schema";
import { createContext, type ReactNode, use } from "react";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import {
  Item,
  ItemContent,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemTitle,
} from "~/components/ui/item";
import { Skeleton } from "~/components/ui/skeleton";
import {
  type CommentReaction,
  CommentReactionSection,
  type CommentReactionToggleInput,
} from "./comment-reaction-section";

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

type PostCommentListProps = {
  comments?: Comment[];
  commentReactions?: CommentReaction[];
  emptyState?: ReactNode;
  errorState?: ReactNode;
  handleToggleCommentReaction?: (
    value: CommentReactionToggleInput
  ) => Promise<void>;
  isError?: boolean;
  isLoading?: boolean;
  loadingState?: ReactNode;
  organizationId: string;
  postId: string;
};

type PostCommentListRootProps = PostCommentListProps & {
  children: ReactNode;
};

type PostCommentListContentProps = {
  children?: ReactNode;
  emptyState?: ReactNode;
  errorState?: ReactNode;
  loadingState?: ReactNode;
};

type PostCommentListItemsProps = {
  children?: ReactNode;
};

type PostCommentListContextValue = {
  commentReactions: CommentReaction[];
  comments: Comment[];
  handleToggleCommentReaction?: (
    value: CommentReactionToggleInput
  ) => Promise<void>;
  isError: boolean;
  isLoading: boolean;
  organizationId: string;
  postId: string;
};

const PostCommentListContext =
  createContext<PostCommentListContextValue | null>(null);
const PostCommentItemContext = createContext<Comment | null>(null);

function usePostCommentList() {
  const value = use(PostCommentListContext);

  if (!value) {
    throw new Error("PostCommentList components must be used within Root.");
  }

  return value;
}

function usePostCommentItem() {
  const value = use(PostCommentItemContext);

  if (!value) {
    throw new Error(
      "PostCommentList item components must be used within Items."
    );
  }

  return value;
}

function PostCommentListRoot({
  commentReactions = [],
  comments = [],
  children,
  handleToggleCommentReaction,
  isError = false,
  isLoading = false,
  organizationId,
  postId,
}: PostCommentListRootProps) {
  return (
    <PostCommentListContext
      value={{
        commentReactions,
        comments,
        handleToggleCommentReaction,
        isError,
        isLoading,
        organizationId,
        postId,
      }}
    >
      {children}
    </PostCommentListContext>
  );
}

function PostCommentListContent({
  children,
  emptyState = null,
  errorState,
  loadingState,
}: PostCommentListContentProps) {
  const { comments, isError, isLoading } = usePostCommentList();

  if (isLoading) {
    return loadingState ?? <PostCommentListSkeleton />;
  }

  if (isError) {
    return (
      errorState ?? (
        <p className="text-muted-foreground text-sm">
          Comments are unavailable right now.
        </p>
      )
    );
  }

  if (comments.length === 0) {
    return emptyState;
  }

  return children ?? <PostCommentListItems />;
}

function PostCommentListItems({ children }: PostCommentListItemsProps) {
  const { comments } = usePostCommentList();

  return (
    <ItemGroup>
      {comments.map((comment) => (
        <PostCommentItemContext key={comment.id} value={comment}>
          {children ?? <PostCommentListDefaultItem />}
        </PostCommentItemContext>
      ))}
    </ItemGroup>
  );
}

function PostCommentListItem({ children }: { children?: ReactNode }) {
  return (
    <Item className="rounded-xl border-border/80 px-4 py-3" variant="outline">
      {children ?? <PostCommentListDefaultItemContent />}
    </Item>
  );
}

function PostCommentListMedia({ children }: { children?: ReactNode }) {
  return (
    <ItemMedia variant="default">
      {children ?? <PostCommentListAvatar />}
    </ItemMedia>
  );
}

function PostCommentListAvatar() {
  const comment = usePostCommentItem();

  return (
    <Avatar size="sm">
      <AvatarFallback>{getInitials(comment.user.name)}</AvatarFallback>
    </Avatar>
  );
}

function PostCommentListMain({ children }: { children?: ReactNode }) {
  return (
    <ItemContent className="gap-2">
      {children ?? <PostCommentListDefaultItemMain />}
    </ItemContent>
  );
}

function PostCommentListHeader({ children }: { children?: ReactNode }) {
  return (
    <ItemHeader className="justify-start gap-2">
      {children ?? (
        <>
          <PostCommentListAuthor />
          <PostCommentListTimestamp />
        </>
      )}
    </ItemHeader>
  );
}

function PostCommentListAuthor() {
  const comment = usePostCommentItem();

  return (
    <ItemTitle className="font-medium text-sm">{comment.user.name}</ItemTitle>
  );
}

function PostCommentListTimestamp() {
  const comment = usePostCommentItem();

  return (
    <span className="text-muted-foreground text-sm">
      {formatRelativeTime(comment.createdAt)}
    </span>
  );
}

function PostCommentListBody() {
  const comment = usePostCommentItem();

  return (
    <div
      className="typography"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: <explanation>
      dangerouslySetInnerHTML={{
        __html: comment.content,
      }}
      data-slot="item-description"
    />
  );
}

function PostCommentListReactions() {
  const {
    commentReactions,
    handleToggleCommentReaction,
    organizationId,
    postId,
  } = usePostCommentList();
  const comment = usePostCommentItem();

  if (!handleToggleCommentReaction) {
    return null;
  }

  return (
    <CommentReactionSection.Root
      commentId={comment.id}
      commentReactions={commentReactions}
      handleToggleReaction={handleToggleCommentReaction}
      organizationId={organizationId}
      postId={postId}
    >
      <CommentReactionSection.Content>
        <CommentReactionSection.List />
        <CommentReactionSection.Button />
      </CommentReactionSection.Content>
    </CommentReactionSection.Root>
  );
}

function PostCommentListDefaultItemContent() {
  return (
    <>
      <PostCommentListMedia />
      <PostCommentListMain />
    </>
  );
}

function PostCommentListDefaultItemMain() {
  return (
    <>
      <PostCommentListHeader />
      <PostCommentListBody />
      <PostCommentListReactions />
    </>
  );
}

function PostCommentListDefaultItem() {
  return <PostCommentListItem />;
}

function PostCommentListComponent({
  commentReactions,
  comments,
  emptyState,
  errorState,
  handleToggleCommentReaction,
  isError,
  isLoading,
  loadingState,
  organizationId,
  postId,
}: PostCommentListProps) {
  return (
    <PostCommentListRoot
      commentReactions={commentReactions}
      comments={comments}
      handleToggleCommentReaction={handleToggleCommentReaction}
      isError={isError}
      isLoading={isLoading}
      organizationId={organizationId}
      postId={postId}
    >
      <PostCommentListContent
        emptyState={emptyState}
        errorState={errorState}
        loadingState={loadingState}
      />
    </PostCommentListRoot>
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

export const PostCommentList = Object.assign(PostCommentListComponent, {
  Author: PostCommentListAuthor,
  Avatar: PostCommentListAvatar,
  Body: PostCommentListBody,
  Content: PostCommentListContent,
  Header: PostCommentListHeader,
  Item: PostCommentListItem,
  Items: PostCommentListItems,
  Main: PostCommentListMain,
  Media: PostCommentListMedia,
  Reactions: PostCommentListReactions,
  Root: PostCommentListRoot,
  Skeleton: PostCommentListSkeleton,
  Timestamp: PostCommentListTimestamp,
});
