import { ConfirmDialog } from "@feeblo/ui/confirm-dialog";
import { toastManager } from "@feeblo/ui/toast";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { settleOptimisticMutation } from "@feeblo/web-shared/collections";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { and, eq, queryOnce } from "@tanstack/react-db";
import { useNavigate } from "@tanstack/react-router";
import { useSelector } from "@xstate/store-react";

import { m } from "../../paraglide/messages.js";
import { usePostDeleteDialogContext } from "../dialog-stores/post";
import { usePostCollections } from "../providers/post-collections-provider";

export function PostDeleteDialog() {
  const store = usePostDeleteDialogContext();
  const { collections, organizationId } = usePostCollections();
  const { allowed: canManageAllPosts } = usePolicy(
    hasPermission(organizationId, "posts.*")
  );
  const open = useSelector(store, (state) => state.context.open);
  const navigate = useNavigate();

  return (
    <ConfirmDialog
      cancelLabel={m.early_careful_coyote()}
      confirmLabel={m.clean_aqua_lion()}
      description={m.brave_sunny_wasp()}
      onConfirm={async () => {
        try {
          const id = store.get().context.data.postId;
          const redirectOptions = store.get().context.data.redirectOptions;

          // Revalidate at confirm time without subscribing: a post engaged
          // after the affordance rendered must not be fired. Eligibility only
          // gates contributors; managers (`posts.*`) delete engaged or other
          // members' posts. Hosts without the collection skip the check; the
          // backend remains authoritative either way.
          if (!canManageAllPosts && collections.deleteEligibilityCollection) {
            const { deleteEligibilityCollection } = collections;
            const fresh = await queryOnce((q) =>
              q
                .from({ eligibility: deleteEligibilityCollection })
                .where(({ eligibility }) =>
                  and(
                    eq(eligibility.organizationId, organizationId),
                    eq(eligibility.postId, id)
                  )
                )
                .select(({ eligibility }) => ({
                  postId: eligibility.postId,
                }))
            );
            if (fresh.length === 0) {
              trackEvent("post_deleted", {
                mode: "single",
                success: false,
              });
              toastManager.add({
                title: m.cozy_safe_pug(),
                type: "error",
              });
              store.send({ type: "setOpen", open: false });
              return;
            }
          }

          // The row is removed optimistically; close and redirect now so
          // high-latency networks don't hold the confirm open.
          store.send({ type: "setOpen", open: false });
          if (redirectOptions) {
            void navigate(redirectOptions);
          }
          settleOptimisticMutation(
            () => collections.postCollection.delete(id),
            () => {
              trackEvent("post_deleted", {
                mode: "single",
                success: true,
              });
              toastManager.add({
                title: m.direct_true_fireant(),
                type: "success",
              });
            },
            () => {
              trackEvent("post_deleted", {
                mode: "single",
                success: false,
              });
              toastManager.add({
                title: m.known_known_vole(),
                type: "error",
              });
            }
          );
        } catch {
          trackEvent("post_deleted", { mode: "single", success: false });
          toastManager.add({
            title: m.known_known_vole(),
            type: "error",
          });
        }
      }}
      onOpenChange={(open) => store.send({ type: "setOpen", open })}
      open={open}
      title={m.wise_wild_poodle()}
    />
  );
}
