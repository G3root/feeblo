import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@feeblo/ui/alert-dialog";
import { Button } from "@feeblo/ui/button";
import { toastManager } from "@feeblo/ui/toast";
import { cn } from "@feeblo/ui/utils";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import {
  hasMembership,
  hasPermission,
  usePolicy,
} from "@feeblo/web-shared/use-policy";
import { inArray, useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";

import {
  useBoardStore,
  useSelectedPostIds,
  useSelectedPosts,
} from "~/features/board/state/board-store-context";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { fetchRpc } from "~/lib/runtime";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

/**
 * Mirrors the backend `PostPolicy.canDelete` for the current selection:
 * `hasMembership AND (posts.* OR every selected post is an untouched post
 * created by the caller)`. `canDeleteAsCreator` is the server-computed
 * new-owner flag for the session user (creator + no comments + no other
 * users' votes), so a contributor may bulk-delete a selection consisting
 * only of their own untouched posts — exactly what PostDelete authorizes.
 */
function useCanBulkDeleteSelectedPosts(): boolean {
  const organizationId = useOrganizationId();
  const { postCollection } = useDashboardCollections();
  const selectedPostIds = useSelectedPostIds();
  const selectionKey = selectedPostIds.join(",");

  const { allowed: canManageAllPosts } = usePolicy(
    hasPermission(organizationId, "posts.*")
  );
  const { allowed: isMember } = usePolicy(hasMembership(organizationId));

  const { data: selectedRows } = useLiveQuery(
    (q) =>
      q
        .from({ post: postCollection })
        .where(({ post }) => inArray(post.id, selectedPostIds)),
    // SAFETY: selectionKey encodes selectedPostIds as the query re-key.
    [selectionKey]
  );

  if (canManageAllPosts) {
    return true;
  }
  if (!isMember || selectedPostIds.length === 0) {
    return false;
  }
  // Every selected post must still be present and flagged as deletable by
  // its creator; a missing row (filtered out, stale selection) disables.
  return (
    selectedRows != null &&
    selectedRows.length === selectedPostIds.length &&
    selectedRows.every((post) => post.canDeleteAsCreator === true)
  );
}

export function BoardPostBulkActions() {
  const selectedPostIds = useSelectedPostIds();
  const store = useBoardStore();
  const selectedCount = selectedPostIds.length;
  const canBulkDelete = useCanBulkDeleteSelectedPosts();

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-3 transition-all duration-200 sm:px-6",
        selectedCount > 0
          ? "translate-y-0 opacity-100"
          : "translate-y-5 opacity-0"
      )}
    >
      <div className="border-border bg-background/95 pointer-events-auto flex items-center gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm">
        <p className="text-sm font-medium">{selectedCount} selected</p>
        <Button
          onClick={() => store.send({ type: "clearSelection" })}
          size="sm"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
        {/* Disabled instead of hidden: contributors keep the affordance and
            learn it applies only to their own untouched posts. */}
        <Button
          disabled={!canBulkDelete}
          onClick={() => store.send({ type: "setBulkDeleteOpen", open: true })}
          size="sm"
          type="button"
          variant="destructive"
        >
          Delete
        </Button>
      </div>
      <BulkDeleteAlert />
    </div>
  );
}

function BulkDeleteAlert() {
  const store = useBoardStore();
  const { postCollection } = useDashboardCollections();
  const selectedPostIds = useSelectedPostIds();
  const selectedPosts = useSelectedPosts();
  const open = useSelector(store, (state) => state.context.bulkDeleteOpen);
  const canBulkDelete = useCanBulkDeleteSelectedPosts();

  const organizationId = useOrganizationId();

  return (
    <AlertDialog
      onOpenChange={(nextOpen) =>
        store.send({ type: "setBulkDeleteOpen", open: nextOpen })
      }
      open={open}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete selected posts</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete{" "}
            {selectedPostIds.length} selected post
            {selectedPostIds.length === 1 ? "" : "s"}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            disabled={!canBulkDelete}
            onClick={async () => {
              if (selectedPostIds.length === 0) {
                store.send({ type: "setBulkDeleteOpen", open: false });
                return;
              }

              try {
                const postIdsByBoardId = new Map<string, string[]>();

                for (const selectedPost of selectedPosts) {
                  const boardPostIds =
                    postIdsByBoardId.get(selectedPost.boardId) ?? [];
                  boardPostIds.push(selectedPost.postId);
                  postIdsByBoardId.set(selectedPost.boardId, boardPostIds);
                }

                await Promise.all(
                  [...postIdsByBoardId.entries()].map(([boardId, postIds]) =>
                    fetchRpc((rpc) =>
                      rpc.PostDelete({
                        id: postIds,
                        boardId,
                        organizationId,
                      })
                    )
                  )
                );

                await postCollection.utils.refetch();
                trackEvent("post_deleted", { mode: "bulk", success: true });

                store.send({ type: "clearSelection" });
                store.send({ type: "setBulkDeleteOpen", open: false });
                toastManager.add({
                  title: `${selectedPostIds.length} post${
                    selectedPostIds.length === 1 ? "" : "s"
                  } deleted successfully`,
                  type: "success",
                });
              } catch (error) {
                trackEvent("post_deleted", {
                  mode: "bulk",
                  success: false,
                });
                console.error(error);
                toastManager.add({
                  title: "Failed to delete selected posts",
                  type: "error",
                });
              }
            }}
            variant="destructive"
          >
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
