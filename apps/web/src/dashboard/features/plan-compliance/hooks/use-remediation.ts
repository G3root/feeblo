import { toastManager } from "@feeblo/ui/toast";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { refetchInBackground } from "@feeblo/web-shared/collections";
import { parseRpcError } from "@feeblo/web-shared/rpc-error";
import { useCallback, useState } from "react";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { useOrganizationId } from "../../../hooks/use-organization-id";
import type {
  RemediationAction,
  RemediationActionType,
} from "../lib/plan-compliance-view";
import { executeRemediation } from "../lib/remediation";

/**
 * Runs one remediation action, then reconciles the snapshot and the cache the
 * action invalidated.
 *
 * The snapshot is awaited because the gate's next render depends on it: the
 * row that succeeded must disappear (and the gate must close when it was the
 * last one) before the toast settles. Feature collections refresh detached —
 * they are other pages' reads, not this one's.
 */
export const useRemediation = () => {
  const organizationId = useOrganizationId();
  const collections = useDashboardCollections();
  const [pendingAction, setPendingAction] = useState<RemediationAction | null>(
    null
  );

  const refreshAffectedCollection = useCallback(
    (type: RemediationActionType): Promise<unknown>[] => {
      // The Record is the exhaustiveness check: a new action type is a compile
      // error here until it names the collection its write invalidated. The
      // functions keep the getters lazy, so a remediation does not materialize
      // every dashboard collection.
      const refreshers = {
        make_board_public: () => [collections.boardCollection.utils.refetch()],
        delete_board: () => [collections.boardCollection.utils.refetch()],
        make_roadmap_public: () => [
          collections.roadmapCollection.utils.refetch(),
        ],
        delete_roadmap: () => [collections.roadmapCollection.utils.refetch()],
        remove_member: () => [
          collections.membersCollection.utils.refetch(),
          collections.invitationsCollection.utils.refetch(),
        ],
        cancel_invitation: () => [
          collections.invitationsCollection.utils.refetch(),
          collections.membersCollection.utils.refetch(),
        ],
        delete_changelog_category: () => [
          collections.changelogCategoryCollection.utils.refetch(),
        ],
        delete_contact: () => [collections.contactCollection.utils.refetch()],
        delete_company: () => [collections.companyCollection.utils.refetch()],
      } satisfies Record<RemediationActionType, () => Promise<unknown>[]>;

      return refreshers[type]();
    },
    [collections]
  );

  const run = useCallback(
    async (action: RemediationAction) => {
      setPendingAction(action);

      try {
        const outcome = await executeRemediation(action, organizationId);

        if (outcome.status === "missing") {
          trackEvent("over_plan_remediation_action", {
            action: action.type,
            success: false,
          });
          toastManager.add({
            title:
              "That item no longer exists. Refresh to see the current state.",
            type: "error",
          });
          return;
        }

        await collections.planComplianceCollection.utils.refetch();
        refetchInBackground(...refreshAffectedCollection(action.type));

        trackEvent("over_plan_remediation_action", {
          action: action.type,
          success: true,
        });
        toastManager.add({ title: action.successTitle, type: "success" });
      } catch (error) {
        // A failed response does not prove the write failed. Re-read the
        // snapshot so the gate shows the server's answer rather than the
        // optimistic assumption.
        refetchInBackground(
          collections.planComplianceCollection.utils.refetch()
        );
        trackEvent("over_plan_remediation_action", {
          action: action.type,
          success: false,
        });
        toastManager.add({
          title: parseRpcError(
            error,
            "The change may not have been saved. Reload to check the workspace."
          ).message,
          type: "error",
        });
      } finally {
        setPendingAction(null);
      }
    },
    [collections, organizationId, refreshAffectedCollection]
  );

  return { pendingAction, run };
};
