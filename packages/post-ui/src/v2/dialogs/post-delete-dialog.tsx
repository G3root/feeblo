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
    <AlertDialog
      onOpenChange={() => store.send({ type: "toggle" })}
      open={open}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{m.wise_wild_poodle()}</AlertDialogTitle>
          <AlertDialogDescription>
            {m.brave_sunny_wasp()}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{m.early_careful_coyote()}</AlertDialogCancel>
          <Button
            onClick={async () => {
              try {
                const id = store.get().context.data.postId;
                const redirectOptions =
                  store.get().context.data.redirectOptions;

                // Revalidate at confirm time without subscribing: a post
                // engaged after the affordance rendered must not be fired.
                // Eligibility only gates contributors; managers (`posts.*`)
                // delete engaged or other members' posts. Hosts without the
                // collection skip the check; the backend remains authoritative
                // either way.
                if (
                  !canManageAllPosts &&
                  collections.deleteEligibilityCollection
                ) {
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
                    store.send({ type: "toggle" });
                    return;
                  }
                }

                // The row is removed optimistically; close and redirect now
                // so high-latency networks don't hold the confirm open.
                store.send({ type: "toggle" });
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
            variant="destructive"
          >
            {m.clean_aqua_lion()}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
