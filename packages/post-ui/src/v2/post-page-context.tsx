import type { TBoard } from "@feeblo/domain/board/schema";
import type { TPost } from "@feeblo/domain/post/schema";
import { createContext, type ReactNode, use } from "react";

type TPageType = "Dashboard" | "PublicPage";

export interface PostCollectionState {
  board: TBoard;
  canManagePost: boolean;
  isArchived: boolean;
  isAuthenticated: boolean;
  isLocked: boolean;
  isMember: boolean;
  isMerged: boolean;
  isPrivateBoard: boolean;
  isPublicBoard: boolean;
  organizationId: string;
  pageType: TPageType;
  post: TPost;
}

export interface PostCollectionDataProviderProps {
  board: TBoard;
  children?: ReactNode;
  organizationId: string;
  pageType: TPageType;
  post: TPost;
}

const PostCollectionDataContext = createContext<PostCollectionState | null>(
  null
);

export function usePostCollectionData() {
  const value = use(PostCollectionDataContext);
  if (!value) {
    throw new Error(
      "usePostCollectionData must be used within PostCollectionDataProvider"
    );
  }
  return value;
}

export function PostCollectionStateProvider({
  children,
  value,
}: {
  children?: ReactNode;
  value: PostCollectionState;
}) {
  return (
    <PostCollectionDataContext value={value}>
      {children}
    </PostCollectionDataContext>
  );
}

export function createPostCollectionState({
  board,
  canManagePost,
  isAuthenticated,
  isMember,
  organizationId,
  pageType,
  post,
}: PostCollectionDataProviderProps &
  Pick<
    PostCollectionState,
    "canManagePost" | "isAuthenticated" | "isMember"
  >): PostCollectionState {
  return {
    board,
    canManagePost,
    isArchived: post.archivedAt != null,
    isAuthenticated,
    isLocked: post.lockedAt != null,
    isMember,
    isMerged: post.mergedIntoPostId != null,
    isPrivateBoard: board.visibility === "PRIVATE",
    isPublicBoard: board.visibility === "PUBLIC",
    organizationId,
    pageType,
    post,
  };
}
