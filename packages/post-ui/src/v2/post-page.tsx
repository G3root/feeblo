import { Skeleton } from "@feeblo/ui/skeleton";
import { lazy, type ReactNode, Suspense } from "react";

import { PostCommentComposer } from "../post/post-comment-composer";
import { CommentsList } from "./comment-display";
import {
  CommentDeleteDialogProvider,
  CommentVisibilityDialogProvider,
  PostDeleteDialogProvider,
} from "./dialog-stores";
import {
  CommentDeleteDialog,
  CommentVisibilityDialog,
  PostDeleteDialog,
} from "./dialogs";
import { PostCollectionDataProvider } from "./post-collection";
import {
  type PostCollectionDataProviderProps,
  usePostCollectionData,
} from "./post-page-context";
import { PostTitleUpdateInput } from "./post-title-input";
import { PostReactionPicker } from "./reaction-picker";
import { SubscribeButton } from "./subscribe-toggle";
import { UpvoteButton } from "./upvote-toggle";

// Post content is rendered as sanitized Markdown in display mode and as the
// rich-text editor in edit mode. Both views are lazy-loaded so the default
// display mode stays lightweight and never pulls in the editor bundle.
const MarkdownContent = lazy(() =>
  import("@feeblo/ui/markdown-content").then((mod) => ({
    default: mod.MarkdownContent,
  }))
);

const PostContentUpdateInput = lazy(() =>
  import("./post-editor").then((mod) => ({
    default: mod.PostContentUpdateInput,
  }))
);

function Root({ children, ...post }: PostCollectionDataProviderProps) {
  return (
    <PostDeleteDialogProvider>
      <CommentDeleteDialogProvider>
        <CommentVisibilityDialogProvider>
          <PostCollectionDataProvider {...post}>
            {children}
            <PostDeleteDialog />
            <CommentDeleteDialog />
            <CommentVisibilityDialog />
          </PostCollectionDataProvider>
        </CommentVisibilityDialogProvider>
      </CommentDeleteDialogProvider>
    </PostDeleteDialogProvider>
  );
}

function Guest({ children }: { children: ReactNode }) {
  return usePostCollectionData().isAuthenticated ? null : children;
}

function Authenticated({ children }: { children: ReactNode }) {
  return usePostCollectionData().isAuthenticated ? children : null;
}

function CanManage({
  children,
}: {
  children: (canManagePost: boolean) => ReactNode;
}) {
  return children(usePostCollectionData().canManagePost);
}

function Locked({ children }: { children: ReactNode }) {
  return usePostCollectionData().isLocked ? children : null;
}

function Unlocked({ children }: { children: ReactNode }) {
  return usePostCollectionData().isLocked ? null : children;
}

function Title() {
  return <PostTitleUpdateInput />;
}

function Content() {
  const { canManagePost, isLocked, post } = usePostCollectionData();

  // Post authors get the rich-text editor; everyone else (readers, locked
  // posts) sees the rendered Markdown.
  if (canManagePost && !isLocked) {
    return (
      <Suspense fallback={<ContentSkeleton />}>
        <PostContentUpdateInput />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<ContentSkeleton />}>
      <MarkdownContent content={post.content} />
    </Suspense>
  );
}

function ContentSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}

function Reactions() {
  return <PostReactionPicker />;
}

function Vote() {
  return <UpvoteButton />;
}

function CompactVote() {
  return <UpvoteButton variant="compact" />;
}

function PublicCommentComposer() {
  return <PostCommentComposer defaultVisibility="PUBLIC" />;
}

function DashboardCommentComposer() {
  return <PostCommentComposer />;
}

function Comments() {
  return <CommentsList />;
}

export const PostPage = {
  Authenticated,
  CanManage,
  Comments,
  CompactVote,
  Content,
  DashboardCommentComposer,
  Guest,
  Locked,
  PublicCommentComposer,
  Reactions,
  Root,
  Subscribe: SubscribeButton,
  Title,
  Unlocked,
  Vote,
};
