import type { TComment } from "@feeblo/domain/src/comments/schema.js";
import { fetchRpc } from "@feeblo/web-shared/runtime";
import { createOptimisticAction } from "@tanstack/react-db";

import { usePostCollections } from "../providers/post-collections-provider";
import { CommentDisplayComponent } from "./component";

interface CommentDisplayItemProps {
  currentUserId?: string;
  data: TComment;
}

export function CommentDisplayItem({
  data,
  currentUserId,
}: CommentDisplayItemProps) {
  const {
    collections: { commentCollection },
  } = usePostCollections();

  const togglePinAction = createOptimisticAction({
    onMutate: () => {
      const willPinned = data.pinnedAt == null;
      commentCollection.update(data.id, (draft) => {
        draft.pinnedAt = willPinned ? new Date() : null;
      });
      // Optimistically unpin other comments in the same post so only one
      // appears pinned before the server round-trip completes.
      // TanStack DB collections are iterable; fall back gracefully if not.
      try {
        const all = (commentCollection as unknown as { toArray?: () => TComment[]; values?: () => Iterable<TComment> }).toArray?.() ?? [];
        for (const other of all as TComment[]) {
          if (
            other.id !== data.id &&
            other.postId === data.postId &&
            other.pinnedAt != null
          ) {
            commentCollection.update(other.id, (draft) => {
              draft.pinnedAt = null;
            });
          }
        }
      } catch {
        // Optimistic unpin of siblings is best-effort; server will reconcile.
      }
    },
    mutationFn: async () => {
      if (data.pinnedAt == null) {
        await fetchRpc((rpc) =>
          rpc.CommentPin({
            id: data.id,
            organizationId: data.organizationId,
            postId: data.postId,
          })
        );
      } else {
        await fetchRpc((rpc) =>
          rpc.CommentUnpin({
            id: data.id,
            organizationId: data.organizationId,
            postId: data.postId,
          })
        );
      }
      await commentCollection.utils.refetch();
    },
  });

  return (
    <CommentDisplayComponent
      authorName={data.user.name}
      commentId={data.id}
      content={data.content}
      createdAt={data.createdAt}
      isAuthor={currentUserId ? data.userId === currentUserId : false}
      isInternal={data.visibility === "INTERNAL"}
      pinnedAt={data.pinnedAt}
      onDelete={() => {}}
      onReply={() => {}}
      onTogglePin={async () => {
        const tx = togglePinAction({});
        await tx.isPersisted.promise;
      }}
      onUpdate={async ({ content, isPrivate }) => {
        const tx = commentCollection.update(data.id, (draft) => {
          draft.content = content;
          draft.visibility = isPrivate ? "INTERNAL" : "PUBLIC";
        });
        await tx.isPersisted.promise;
      }}
      postId={data.postId}
      postSlug={data.postSlug}
    />
  );
}
