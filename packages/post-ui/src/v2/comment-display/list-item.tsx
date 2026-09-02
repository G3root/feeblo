import type { TComment } from "@feeblo/domain/src/comments/schema.js";
import { fetchRpc } from "@feeblo/web-shared/runtime";
import {
  and,
  createOptimisticAction,
  eq,
  isNull,
  not,
  queryOnce,
  useLiveQuery,
} from "@tanstack/react-db";

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
    collections: { commentCollection, postStatusCollection },
  } = usePostCollections();

  // Derive the status-update type by joining the comment's FK onto the
  // org-scoped post status collection (labels/colors live client-side).
  const { data: statusUpdateRows } = useLiveQuery(
    (q) =>
      q
        .from({ postStatus: postStatusCollection })
        .where(({ postStatus }) =>
          eq(postStatus.id, data.statusUpdateId ?? "")
        ),
    [data.statusUpdateId]
  );
  const statusUpdateType = statusUpdateRows?.[0]?.type ?? null;

  const togglePinAction = createOptimisticAction({
    onMutate: () => {
      const willPinned = data.pinnedAt == null;
      commentCollection.update(data.id, (draft) => {
        draft.pinnedAt = willPinned ? new Date() : null;
      });
      // Optimistically unpin other comments in the same post so only one
      // appears pinned before the server round-trip completes. Query the
      // pinned siblings with queryOnce instead of scanning the collection.
      queryOnce((q) =>
        q
          .from({ comment: commentCollection })
          .where(({ comment }) =>
            and(
              eq(comment.postId, data.postId),
              not(isNull(comment.pinnedAt)),
              not(eq(comment.id, data.id))
            )
          )
      )
        .then((pinnedSiblings) => {
          for (const other of pinnedSiblings) {
            commentCollection.update(other.id, (draft) => {
              draft.pinnedAt = null;
            });
          }
        })
        .catch(() => {
          // Optimistic unpin of siblings is best-effort; server will reconcile.
        });
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
      statusUpdateType={statusUpdateType}
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
