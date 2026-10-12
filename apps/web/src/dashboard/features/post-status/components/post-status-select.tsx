import { usePostCollectionData } from "@feeblo/post-ui/post-page-context";
import { StatusField } from "@feeblo/post-ui/post-properties";
import { toastManager } from "@feeblo/ui/toast";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";

import { useOrgPostStatuses } from "~/hooks/use-org-post-statuses";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

export function PostStatusSelect({ disabled = false }: { disabled?: boolean }) {
  const { post, organizationId, isLocked, isMerged } = usePostCollectionData();
  const { allowed: canChangeStatus } = usePolicy(
    hasPermission(organizationId, "posts.status")
  );
  const isDisabled = disabled || isLocked || isMerged || !canChangeStatus;
  const { postCollection } = useDashboardCollections();

  const { data: postStatuses } = useOrgPostStatuses(organizationId);

  if (!postStatuses) {
    return null;
  }

  return (
    <StatusField
      currentStatusId={post.statusId}
      disabled={isDisabled}
      onValueChange={async (nextPostStatus) => {
        if (!nextPostStatus || isDisabled) {
          return;
        }
        try {
          const tx = postCollection.update(post.id, (draft) => {
            draft.statusId = nextPostStatus.id;
          });
          await tx.isPersisted.promise;
          trackEvent("post_updated", { field: "status", success: true });

          toastManager.add({
            title: "Status updated",
            type: "success",
          });
        } catch {
          trackEvent("post_updated", { field: "status", success: false });
          toastManager.add({
            title: "Failed to update status",
            type: "error",
          });
        }
      }}
      statuses={postStatuses}
    />
  );
}
