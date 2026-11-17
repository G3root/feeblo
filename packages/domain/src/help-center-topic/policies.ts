import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";

/**
 * Who may shape the help center.
 *
 * Both resources are manager-owned content, like the changelog they sit beside
 * on the portal: `helpCenterTopics.*` for the sections and
 * `helpCenterArticles.*` for the pages. Reading is not gated here — the portal
 * surface asks `SitePolicy.canViewHelpCenter`, and the dashboard asks for
 * membership.
 *
 * There is no entitlement check on a topic. The plan limit counts articles
 * (see `EntitlementPolicy.canCreateHelpCenterArticle`), so a topic is free:
 * charging for the container and not the contents would let a workspace at its
 * article limit keep creating empty sections with no way to fill them.
 */
const makeHelpCenterTopicPolicy = () => {
  const canCreate = (organizationId: string) =>
    Policy.all(
      Policy.hasMembership(organizationId),
      Policy.canPermission(organizationId, "helpCenterTopics.create")
    );

  const canUpdate = (organizationId: string) =>
    Policy.all(
      Policy.hasMembership(organizationId),
      Policy.canPermission(organizationId, "helpCenterTopics.*")
    );

  const canDelete = (organizationId: string) =>
    Policy.all(
      Policy.hasMembership(organizationId),
      Policy.canPermission(organizationId, "helpCenterTopics.*")
    );

  /**
   * Reordering is a write to every topic's position at once, so it needs the
   * update grant rather than create — a contributor who may add a section
   * still may not renumber the whole list.
   */
  const canReorder = canUpdate;

  return { canCreate, canUpdate, canDelete, canReorder };
};

export class HelpCenterTopicPolicy extends Context.Service<HelpCenterTopicPolicy>()(
  "HelpCenterTopicPolicy",
  {
    make: Effect.sync(makeHelpCenterTopicPolicy),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
