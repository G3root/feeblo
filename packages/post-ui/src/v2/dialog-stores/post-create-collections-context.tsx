import type { TBoard } from "@feeblo/domain/board/schema";
import type { TPost } from "@feeblo/domain/post/schema";
import type { TPostStatus } from "@feeblo/domain/post-status/schema";
import type { Collection } from "@tanstack/react-db";
import { createContext, useContext } from "react";

//Todo fix the type error later
export interface PostCreateCollections {
  boardCollection: Collection<TBoard, string, any, any>;
  membersCollection?: Collection<
    { id: string; organizationId: string; userId: string },
    string,
    any,
    any
  >;
  postCollection: Collection<TPost, string, any, any>;
  postStatusCollection: Collection<TPostStatus, string, any, any>;
}

export interface PostCreateCollectionsValue {
  collections: PostCreateCollections;
  organizationId: string;
}

const PostCreateCollectionsContext =
  createContext<PostCreateCollectionsValue | null>(null);

export function usePostCreateCollections() {
  const ctx = useContext(PostCreateCollectionsContext);
  if (!ctx) {
    throw new Error(
      "usePostCreateCollections must be used within PostCreateCollectionsProvider"
    );
  }
  return ctx;
}

export function PostCreateCollectionsProvider({
  children,
  collections,
  organizationId,
}: {
  children: React.ReactNode;
  collections: PostCreateCollections;
  organizationId: string;
}) {
  return (
    <PostCreateCollectionsContext.Provider
      value={{ collections, organizationId }}
    >
      {children}
    </PostCreateCollectionsContext.Provider>
  );
}
