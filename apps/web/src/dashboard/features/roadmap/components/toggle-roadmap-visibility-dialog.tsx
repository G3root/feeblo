import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@feeblo/ui/alert-dialog";
import { Button } from "@feeblo/ui/button";
import { toastManager } from "@feeblo/ui/toast";
import { SparklesIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useSelector } from "@xstate/store-react";
import { useState } from "react";
import { useUpgradePlanDialogContext } from "~/features/billing/dialog-stores";
import { useEntitlements } from "~/hooks/use-entitlements";
import { roadmapCollection } from "~/lib/collections";
import { useToggleRoadmapVisibilityDialogContext } from "../dialog-stores";

export function ToggleRoadmapVisibilityDialog() {
  const store = useToggleRoadmapVisibilityDialogContext();
  const open = useSelector(store, (state) => state.context.open);
  const { roadmapId, currentVisibility } = useSelector(
    store,
    (state) => state.context.data
  );
  const { entitlements } = useEntitlements();
  const upgradePlanStore = useUpgradePlanDialogContext();
  const [isPending, setIsPending] = useState(false);

  const isPrivate = currentVisibility === "private";
  const nextVisibility = isPrivate ? "public" : "private";
  const requiresUpgrade = !(
    isPrivate || entitlements.capabilities.privateRoadmaps
  );

  let title = "Make roadmap private?";
  let description =
    "Only members of this workspace will be able to view this roadmap.";
  let actionLabel = "Make private";

  if (isPrivate) {
    title = "Make roadmap public?";
    description = "Anyone with the link will be able to view this roadmap.";
    actionLabel = "Make public";
  }

  if (requiresUpgrade) {
    title = "Private roadmaps require an upgrade";
    description =
      "Making a roadmap private requires the Starter plan or higher.";
  }

  if (isPending) {
    actionLabel = "Updating...";
  }

  const handleConfirm = async () => {
    if (requiresUpgrade) {
      store.send({ type: "toggle" });
      upgradePlanStore.send({ type: "toggle" });
      return;
    }

    setIsPending(true);
    try {
      const tx = roadmapCollection.update(roadmapId, (draft) => {
        draft.visibility = nextVisibility;
        draft.updatedAt = new Date();
      });
      await tx.isPersisted.promise;

      store.send({ type: "toggle" });
      toastManager.add({
        title: isPrivate ? "Roadmap is now public" : "Roadmap is now private",
        type: "success",
      });
    } catch (_error) {
      toastManager.add({
        title: "Failed to update roadmap visibility",
        type: "error",
      });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <AlertDialog
      onOpenChange={() => store.send({ type: "toggle" })}
      open={open}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          {requiresUpgrade ? (
            <Button onClick={handleConfirm}>
              <HugeiconsIcon icon={SparklesIcon} />
              Upgrade plan
            </Button>
          ) : (
            <AlertDialogAction disabled={isPending} onClick={handleConfirm}>
              {actionLabel}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
