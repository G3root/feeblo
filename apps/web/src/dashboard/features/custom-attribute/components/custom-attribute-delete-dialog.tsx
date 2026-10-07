import { ConfirmDialog } from "@feeblo/ui/confirm-dialog";
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
    <ConfirmDialog
      description="This action cannot be undone. This will permanently delete the custom attribute."
      onConfirm={() => {
        const { attributeId } = store.get().context.data;
        const collection = getCollection(entityType, collections);
        // The row is removed optimistically; close the confirm in the same
        // tick and settle persistence in the background.
        store.send({ type: "setOpen", open: false });
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
      onOpenChange={(open) => store.send({ type: "setOpen", open })}
      open={open}
      title="Delete Attribute"
    />
  );
}
