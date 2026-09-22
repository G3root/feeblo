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
import { useSelector } from "@xstate/store-react";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import {
  type CustomAttributeEntityType,
  useCustomAttributeDeleteDialogContext,
} from "../dialog-stores";

function getCollection(
  entityType: CustomAttributeEntityType,
  collections: ReturnType<typeof useDashboardCollections>
) {
  return entityType === "contact"
    ? collections.contactAttributeDefinitionCollection
    : collections.companyAttributeDefinitionCollection;
}

export function CustomAttributeDeleteDialog() {
  const store = useCustomAttributeDeleteDialogContext();
  const collections = useDashboardCollections();
  const open = useSelector(store, (state) => state.context.open);
  const entityType = useSelector(
    store,
    (state) => state.context.data.entityType
  );

  return (
    <AlertDialog
      onOpenChange={() => store.send({ type: "toggle" })}
      open={open}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Attribute</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete the
            custom attribute.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            onClick={() => {
              const { attributeId } = store.get().context.data;
              const collection = getCollection(entityType, collections);
              // The row is removed optimistically; close the confirm in the
              // same tick and settle persistence in the background.
              store.send({ type: "toggle" });
              settleOptimisticMutation(
                () => collection.delete(attributeId),
                () => {
                  trackEvent("custom_attribute_deleted", {
                    entity_type: entityType,
                    success: true,
                  });
                  toastManager.add({
                    title: "Attribute deleted successfully",
                    type: "success",
                  });
                },
                () => {
                  trackEvent("custom_attribute_deleted", {
                    entity_type: entityType,
                    success: false,
                  });
                  toastManager.add({
                    title: "Failed to delete attribute",
                    type: "error",
                  });
                }
              );
            }}
            variant="destructive"
          >
            Continue
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
