import { fetchRpc } from "~/lib/runtime";

import type { RemediationAction } from "./plan-compliance-view";

export type RemediationOutcome =
  | { readonly status: "done" }
  | { readonly status: "missing" };

/**
 * Performs the write behind one remediation row.
 *
 * Every call is the existing dashboard RPC — no new write surface — so the
 * same permission, validation, and audit path that guards the settings page
 * guards the gate. The organization comes from the route, never from the
 * snapshot, so a stale row cannot be replayed into another workspace.
 */
export async function executeRemediation(
  action: RemediationAction,
  organizationId: string
): Promise<RemediationOutcome> {
  switch (action.type) {
    case "make_board_public": {
      // UpdateBoard replaces the name too, so the label captured in the
      // snapshot cannot be replayed: a rename in another tab would be undone.
      const boards = await fetchRpc((rpc) =>
        rpc.ListBoards({ organizationId })
      );
      const board = boards.find(
        (candidate) => candidate.id === action.resourceId
      );

      if (!board) {
        return { status: "missing" };
      }

      await fetchRpc((rpc) =>
        rpc.UpdateBoard({
          id: board.id,
          name: board.name,
          visibility: "PUBLIC",
          organizationId,
        })
      );
      break;
    }

    case "delete_board":
      await fetchRpc((rpc) =>
        rpc.DeleteBoard({ id: action.resourceId, organizationId })
      );
      break;

    case "make_roadmap_public": {
      // UpdateRoadmap replaces the whole row, so the current row is the input.
      // A missing row means another tab resolved it between the snapshot and
      // this click; that is an ordinary outcome, not a failure to retry.
      const roadmaps = await fetchRpc((rpc) =>
        rpc.ListRoadmaps({ organizationId })
      );
      const roadmap = roadmaps.find(
        (candidate) => candidate.id === action.resourceId
      );

      if (!roadmap) {
        return { status: "missing" };
      }

      await fetchRpc((rpc) =>
        rpc.UpdateRoadmap({ ...roadmap, visibility: "public" })
      );
      break;
    }

    case "delete_roadmap":
      await fetchRpc((rpc) =>
        rpc.DeleteRoadmap({ id: action.resourceId, organizationId })
      );
      break;

    case "remove_member":
      await fetchRpc((rpc) =>
        rpc.RemoveOrganizationMember({
          memberId: action.resourceId,
          organizationId,
        })
      );
      break;

    case "cancel_invitation":
      await fetchRpc((rpc) =>
        rpc.CancelOrganizationInvitation({
          invitationId: action.resourceId,
          organizationId,
        })
      );
      break;

    case "delete_changelog_category":
      await fetchRpc((rpc) =>
        rpc.DeleteChangelogCategory({ id: action.resourceId, organizationId })
      );
      break;

    case "delete_contact":
      await fetchRpc((rpc) =>
        rpc.DeleteContact({ id: action.resourceId, organizationId })
      );
      break;

    case "delete_company":
      await fetchRpc((rpc) =>
        rpc.DeleteCompany({ id: action.resourceId, organizationId })
      );
      break;
  }

  return { status: "done" };
}
