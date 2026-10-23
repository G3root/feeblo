import { Button } from "@feeblo/ui/button";
import { ConfirmDialog } from "@feeblo/ui/confirm-dialog";
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

import { useOccupyMobileBottomSlot } from "~/components/common/mobile-bottom-slot";
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
 * their own untouched posts — exactly what DeletePost authorizes.
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
    // The board surface re-renders on every keystroke/filter change, so this
    // selection-scoped query takes the hot-path escape hatch.
    queryKey: [
      "board-bulk-delete-eligibility",
      deleteEligibilityCollection?.id ?? null,
      organizationId,
      contributorCase,
      selectedPostIds,
    ],
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

// The bar replaces the bottom nav in the same slot, so a tap should feel the
// same in both: 150ms press feedback at the nav's 0.97 scale.
const actionPressFeedback =
  "ease-out-strong transition-[scale,box-shadow] duration-150 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100";

export function BoardPostBulkActions() {
  const selectedPostIds = useSelectedPostIds();
  const store = useBoardStore();
  const selectedCount = selectedPostIds.length;
  const canBulkDelete = useCanBulkDeleteSelectedPosts();

  // Phones have no room for two floating bars, and a Delete button parked
  // directly above the bottom nav is a mis-tap waiting to happen. The bar
  // takes the nav's slot instead: the nav fades out while a selection exists
  // and returns when the selection is cleared (including on unmount).
  useOccupyMobileBottomSlot(selectedCount > 0);

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 z-50 flex justify-center px-3 sm:px-6",
        // The nav only exists below `md`, so the bar shares that breakpoint:
        // it sits at the nav's exact height (safe-area aware) on phones and
        // keeps the desktop floating position from `md` up.
        "bottom-[max(calc(var(--spacing)*4),env(safe-area-inset-bottom))] md:bottom-6",
        // Explicit properties only: `transition-all` also animates the
        // border/background under a theme switch. `filter` is the 2px blur
        // mask that softens the crossfade with the nav — both pills occupy
        // this slot, and a raw crossfade double-exposes their icons and text.
        // Rest state is `[filter:none]`, not `blur-0`: any filter value makes
        // this container a backdrop root, which would cut the inner pill off
        // from the page behind its `backdrop-blur-sm`.
        "ease-out-strong transition-[opacity,translate,filter] motion-reduce:transition-opacity",
        // Asymmetric by state: CSS reads the duration off the destination
        // style, so the bar takes 200ms to come in and snaps away in 150ms —
        // the system answers fast, the entrance stays legible.
        selectedCount > 0
          ? "translate-y-0 opacity-100 [filter:none] duration-200"
          : "translate-y-5 opacity-0 blur-[2px] duration-150"
      )}
      // Hidden means hidden: without `inert` the transparent bar still sat in
      // the tab order and swallowed taps meant for the nav underneath it.
      inert={selectedCount === 0}
    >
      <div
        className={cn(
          "border-border bg-background/95 flex items-center gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm",
          selectedCount > 0 && "pointer-events-auto"
        )}
      >
        <p className="text-sm font-medium">{selectedCount} selected</p>
        <Button
          className={actionPressFeedback}
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
          className={actionPressFeedback}
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
    <ConfirmDialog
      confirmDisabled={!canBulkDelete}
      confirmLabel="Delete"
      description={`This action cannot be undone. This will permanently delete ${selectedPostIds.length} selected post${selectedPostIds.length === 1 ? "" : "s"}.`}
      onConfirm={async () => {
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
                            eq(eligibility.organizationId, organizationId),
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
          const skippedCount = selectedPosts.length - deletablePosts.length;
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
            refetchInBackground(deleteEligibilityCollection?.utils.refetch());
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
      onOpenChange={(nextOpen) =>
        store.send({ type: "setBulkDeleteOpen", open: nextOpen })
      }
      open={open}
      title="Delete selected posts"
    />
  );
}
