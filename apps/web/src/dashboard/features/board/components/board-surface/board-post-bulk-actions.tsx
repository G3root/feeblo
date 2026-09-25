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
  refetchInBackground,
  settleOptimisticMutation,
} from "@feeblo/web-shared/collections";
import {
  hasMembership,
  hasPermission,
  usePolicy,
} from "@feeblo/web-shared/use-policy";
import { and, eq, inArray, queryOnce, useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";

import {
  useBoardStore,
  useSelectedPostIds,
  useSelectedPosts,
} from "~/features/board/state/board-store-context";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

/**
 * Mirrors the backend `PostPolicy.canDelete` for the current selection:
 * `hasMembership AND (posts.* OR every selected post is an untouched post
 * created by the caller)`. Eligibility syncs once per organization into a
 * collection; every selection check below is a client-side live query with
 * no RPC, so a contributor may bulk-delete a selection consisting only of
 * their own untouched posts — exactly what PostDelete authorizes.
 */
function useCanBulkDeleteSelectedPosts(): boolean {
  const organizationId = useOrganizationId();
  const selectedPostIds = useSelectedPostIds();

  const { allowed: canManageAllPosts } = usePolicy(
    hasPermission(organizationId, "posts.*")
  );
  const { allowed: isMember } = usePolicy(hasMembership(organizationId));

  // Eligibility only concerns contributors: managers bypass the check and
  // non-members/empty selections can never delete. The eligible set syncs
  // once per organization; this check is purely client-side.
  const contributorCase =
    !canManageAllPosts && isMember && selectedPostIds.length > 0;
  const { deleteEligibilityCollection } = useDashboardCollections();
  const { data: eligibleRows } = useLiveQuery({
    query: (q) => {
      if (!contributorCase || !deleteEligibilityCollection) {
        return undefined;
      }
      return q
        .from({ eligibility: deleteEligibilityCollection })
        .where(({ eligibility }) =>
          and(
            eq(eligibility.organizationId, organizationId),
            inArray(eligibility.postId, selectedPostIds)
          )
        )
        .select(({ eligibility }) => ({ postId: eligibility.postId }));
    },
  });

  if (canManageAllPosts) {
    return true;
  }
  if (!contributorCase || !eligibleRows) {
    return false;
  }
  // Every selected post must resolve eligible; a missing row (filtered
  // out, stale selection) simply isn't in the eligible set.
  const eligibleIds = new Set(eligibleRows.map((row) => row.postId));
  return selectedPostIds.every((postId) => eligibleIds.has(postId));
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
  const { deleteEligibilityCollection, postCollection } =
    useDashboardCollections();
  const selectedPostIds = useSelectedPostIds();
  const selectedPosts = useSelectedPosts();
  const open = useSelector(store, (state) => state.context.bulkDeleteOpen);
  const canBulkDelete = useCanBulkDeleteSelectedPosts();

  const organizationId = useOrganizationId();
  const { allowed: canManageAllPosts } = usePolicy(
    hasPermission(organizationId, "posts.*")
  );

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
                // Revalidate against the synced set at confirm time: a post
                // engaged after the affordance rendered must not be fired.
                // `queryOnce` evaluates without subscribing; the backend
                // remains authoritative for anything that slips through.
                // Contributor-only: the synced set holds the caller's own
                // untouched posts, so managers (`posts.*`) bypass it entirely
                // and delete every selected post through the backend policy.
                const freshEligibility =
                  !canManageAllPosts && deleteEligibilityCollection
                    ? new Set(
                        (
                          await queryOnce((q) =>
                            q
                              .from({
                                eligibility: deleteEligibilityCollection,
                              })
                              .where(({ eligibility }) =>
                                and(
                                  eq(
                                    eligibility.organizationId,
                                    organizationId
                                  ),
                                  inArray(eligibility.postId, selectedPostIds)
                                )
                              )
                              .select(({ eligibility }) => ({
                                postId: eligibility.postId,
                              }))
                          )
                        ).map((row) => row.postId)
                      )
                    : null;
                const deletablePosts =
                  freshEligibility === null
                    ? selectedPosts
                    : selectedPosts.filter((selectedPost) =>
                        freshEligibility.has(selectedPost.postId)
                      );
                const skippedCount =
                  selectedPosts.length - deletablePosts.length;
                if (deletablePosts.length === 0) {
                  trackEvent("post_deleted", {
                    mode: "bulk",
                    success: false,
                  });
                  toastManager.add({
                    title:
                      "These posts can no longer be deleted. The selection was refreshed.",
                    type: "error",
                  });
                  refetchInBackground(
                    deleteEligibilityCollection?.utils.refetch()
                  );
                  store.send({ type: "setBulkDeleteOpen", open: false });
                  return;
                }

                // The rows are removed optimistically in one transaction;
                // the collection handler groups them into one bulk RPC per
                // board. Close the confirm now and settle persistence in the
                // background so a slow network never holds the dialog open.
                store.send({ type: "clearSelection" });
                store.send({ type: "setBulkDeleteOpen", open: false });
                settleOptimisticMutation(
                  () =>
                    postCollection.delete(
                      deletablePosts.map((selectedPost) => selectedPost.postId)
                    ),
                  () => {
                    trackEvent("post_deleted", { mode: "bulk", success: true });
                    toastManager.add({
                      title:
                        skippedCount > 0
                          ? `${deletablePosts.length} post${
                              deletablePosts.length === 1 ? "" : "s"
                            } deleted, ${skippedCount} skipped (no longer deletable)`
                          : `${deletablePosts.length} post${
                              deletablePosts.length === 1 ? "" : "s"
                            } deleted successfully`,
                      type: "success",
                    });
                  },
                  () => {
                    trackEvent("post_deleted", {
                      mode: "bulk",
                      success: false,
                    });
                    toastManager.add({
                      title: "Failed to delete selected posts",
                      type: "error",
                    });
                  }
                );
              } catch {
                trackEvent("post_deleted", {
                  mode: "bulk",
                  success: false,
                });
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
