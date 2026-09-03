import { lazy, type ReactNode, Suspense } from "react";

import { PostCommentComposer } from "../post/post-comment-composer";
import { CommentsList } from "./comment-display/list";
import { ContentSkeleton } from "./content-skeleton";
import { CommentDeleteDialogProvider } from "./dialog-stores/comment";
import { CommentVisibilityDialogProvider } from "./dialog-stores/comment-visibility";
import { PostDeleteDialogProvider } from "./dialog-stores/post";
import { CommentDeleteDialog } from "./dialogs/comment-delete-dialog";
import { CommentVisibilityDialog } from "./dialogs/comment-visibility-dialog";
import { PostDeleteDialog } from "./dialogs/post-delete-dialog";
import { PostCollectionDataProvider } from "./post-collection";
import {
  type PostCollectionDataProviderProps,
  usePostCollectionData,
} from "./post-page-context";
import { PostTitleUpdateInput } from "./post-title-input";
import { PostReactionPicker } from "./reaction-picker";
import { SubscribeCard } from "./subscribe-toggle";
import { UpvoteButton } from "./upvote-toggle";
import { usePostDetail } from "./use-post-detail";

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
  const { canManagePost, isLocked } = usePostCollectionData();

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
      <DetailMarkdown />
    </Suspense>
  );
}

function DetailMarkdown() {
  const { content, isError, isLoading } = usePostDetail();

  // The body streams in separately from the list row (see `usePostDetail`);
  // keep the rest of the page interactive while it resolves, and degrade to
  // an inline error instead of unmounting the page when it fails.
  if (isError) {
    return (
      <p className="text-muted-foreground text-sm">
        Post content could not be loaded.
      </p>
    );
  }

  if (isLoading || content === undefined) {
    return <ContentSkeleton />;
  }

  return <MarkdownContent content={content} />;
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
  Subscribe: SubscribeCard,
  Title,
  Unlocked,
  Vote,
};
