import type { ReactNode } from "react";
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
import { PostContentUpdateInput } from "./post-editor";
import {
  type PostCollectionDataProviderProps,
  usePostCollectionData,
} from "./post-page-context";
import { PostTitleUpdateInput } from "./post-title-input";
import { PostReactionPicker } from "./reaction-picker";
import { UpvoteButton } from "./upvote-toggle";

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

function CanManage({ children }: { children: ReactNode }) {
  return usePostCollectionData().canManagePost ? children : null;
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
  return <PostContentUpdateInput />;
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
  Title,
  Unlocked,
  Vote,
};
