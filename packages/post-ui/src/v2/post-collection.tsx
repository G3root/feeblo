import type { TBoard } from "@feeblo/domain/board/schema";
import type { TPost } from "@feeblo/domain/post/schema";
import {
  anyPolicy,
  hasOwnerOrAdminRole,
  isUser,
  usePolicy,
} from "@feeblo/web-shared/use-policy";
import { createContext, type ReactNode, use } from "react";

export interface PostCollectionState {
  board: TBoard;
  canManagePost: boolean;
  isArchived: boolean;
  isLocked: boolean;
  isMerged: boolean;
  isPrivateBoard: boolean;
  isPublicBoard: boolean;
  organizationId: string;
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

export interface PostCollectionDataProviderProps {
  board: TBoard;
  children?: ReactNode;
  organizationId: string;
  post: TPost;
}

export function PostCollectionDataProvider({
  board,
  children,
  post,
  organizationId,
}: PostCollectionDataProviderProps) {
  const { allowed: canManagePost } = usePolicy(
    anyPolicy(
      hasOwnerOrAdminRole(organizationId),
      isUser(post?.creatorId ?? "")
    )
  );

  const state: PostCollectionState = {
    board,
    isArchived: post.archivedAt !== null && post.archivedAt !== undefined,
    isLocked: post.lockedAt !== null && post.lockedAt !== undefined,
    isMerged:
      post.mergedIntoPostId !== null && post.mergedIntoPostId !== undefined,
    isPrivateBoard: board.visibility === "PRIVATE",
    isPublicBoard: board.visibility === "PUBLIC",
    post,
    canManagePost,
    organizationId,
  };

  return (
    <PostCollectionDataContext value={{ ...state }}>
      {children}
    </PostCollectionDataContext>
  );
}
