import type { Comment } from "@feeblo/domain/comments/schema";
import { Delete02Icon, Ellipsis } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createContext, type ReactNode, use } from "react";
import { Avatar, AvatarFallback } from "@feeblo/ui/avatar";
import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@feeblo/ui/dropdown-menu";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemTitle,
} from "@feeblo/ui/item";
import { Skeleton } from "@feeblo/ui/skeleton";
import { toastManager } from "@feeblo/ui/toast";
import { authClient } from "~/lib/auth-client";
import { cn } from "~/lib/utils";
import {
  type CommentReaction,
  CommentReactionSection,
  type CommentReactionToggleInput,
} from "./comment-reaction-section";

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const WHITESPACE_REGEX = /\s+/;

type PostCommentListProps = {
  comments?: Comment[];
  commentReactions?: CommentReaction[];
  emptyState?: ReactNode;
  errorState?: ReactNode;
  handleDeleteComment?: (commentId: string) => Promise<void>;
  handleToggleCommentReaction?: (
    value: CommentReactionToggleInput
  ) => Promise<void>;
  isError?: boolean;
  isLocked?: boolean;
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
  handleDeleteComment?: (commentId: string) => Promise<void>;
  handleToggleCommentReaction?: (
    value: CommentReactionToggleInput
  ) => Promise<void>;
  isError: boolean;
  isLocked: boolean;
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
  handleDeleteComment,
  handleToggleCommentReaction,
  isError = false,
  isLocked = false,
  isLoading = false,
  organizationId,
  postId,
}: PostCommentListRootProps) {
  return (
    <PostCommentListContext
      value={{
        commentReactions,
        comments,
        handleDeleteComment,
        handleToggleCommentReaction,
        isError,
        isLocked,
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
  const comment = usePostCommentItem();
  return (
    <Item
      className={cn(comment.visibility === "INTERNAL" && "bg-primary/10")}
      variant="outline"
    >
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
    <div className="flex items-center gap-2">
      <ItemTitle className="font-medium text-sm">{comment.user.name}</ItemTitle>
      {comment.visibility === "INTERNAL" ? (
        <Badge variant="default">Internal note</Badge>
      ) : null}
    </div>
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
      // biome-ignore lint/security/noDangerouslySetInnerHtml: comments are stored as sanitized rich text
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
    isLocked,
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
      disabled={isLocked}
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

function PostCommentListActions() {
  const { data: session } = authClient.useSession();
  const { handleDeleteComment, isLocked } = usePostCommentList();
  const comment = usePostCommentItem();

  if (
    !handleDeleteComment ||
    isLocked ||
    session?.user?.id !== comment.userId
  ) {
    return null;
  }

  return (
    <ItemActions className="self-start">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label="Comment actions"
              className="rounded-full"
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon icon={Ellipsis} />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem
            onClick={async () => {
              try {
                await handleDeleteComment(comment.id);
                toastManager.add({
                  title: "Comment deleted successfully",
                  type: "success",
                });
              } catch (_error) {
                toastManager.add({
                  title: "Failed to delete comment",
                  type: "error",
                });
              }
            }}
            variant="destructive"
          >
            <HugeiconsIcon icon={Delete02Icon} /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ItemActions>
  );
}

function PostCommentListDefaultItemContent() {
  return (
    <>
      <PostCommentListMedia />
      <PostCommentListMain />
      <PostCommentListActions />
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
  handleDeleteComment,
  handleToggleCommentReaction,
  isError,
  isLocked,
  isLoading,
  loadingState,
  organizationId,
  postId,
}: PostCommentListProps) {
  return (
    <PostCommentListRoot
      commentReactions={commentReactions}
      comments={comments}
      handleDeleteComment={handleDeleteComment}
      handleToggleCommentReaction={handleToggleCommentReaction}
      isError={isError}
      isLoading={isLoading}
      isLocked={isLocked}
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

  const segments = normalized.split(WHITESPACE_REGEX).slice(0, 2);
  return segments.map((segment) => segment.charAt(0).toUpperCase()).join("");
}

export const PostCommentList = Object.assign(PostCommentListComponent, {
  Actions: PostCommentListActions,
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
