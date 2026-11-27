import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EntitlementPolicy } from "../entitlement/policies";
import { HelpCenterTopicRepository } from "../help-center-topic/repository";
import * as Policy from "../policy";
import { HelpCenterArticleRepository } from "./repository";

type TCanCreate = {
  organizationId: string;
};

const makeHelpCenterArticlePolicy = Effect.gen(function* () {
  const repository = yield* HelpCenterArticleRepository;
  const topicRepository = yield* HelpCenterTopicRepository;
  const entitlementPolicy = yield* EntitlementPolicy;

  /**
   * A create is gated by the plan's article allowance on top of the
   * permission.
   *
   * The count is an `Effect`, not a number, so the plan lookup and the count
   * run together rather than as two round trips — the same shape
   * `canCreateChangelogCategory` uses. The free plan's ceiling is 25 articles
   * and the paid plans' is null, so the comparison is skipped entirely there.
   */
  const canCreate = (args: TCanCreate) =>
    Policy.all(
      Policy.hasMembership(args.organizationId),
      Policy.canPermission(args.organizationId, "helpCenterArticles.create"),
      entitlementPolicy.canCreateHelpCenterArticle({
        organizationId: args.organizationId,
        articleCount: repository.countByOrganizationId({
          organizationId: args.organizationId,
        }),
      })
    );

  /**
   * Editing an article.
   *
   * `update` rather than the resource wildcard: the action is the grant the
   * table declares, and a manager's `helpCenterArticles.*` still satisfies it
   * through the wildcard. A role that may edit is deliberately not the same
   * set as one that may publish.
   */
  const canUpdate = (organizationId: string) =>
    Policy.all(
      Policy.hasMembership(organizationId),
      Policy.canPermission(organizationId, "helpCenterArticles.update")
    );

  const canDelete = (organizationId: string) =>
    Policy.all(
      Policy.hasMembership(organizationId),
      Policy.canPermission(organizationId, "helpCenterArticles.delete")
    );

  /**
   * Putting a page in front of readers.
   *
   * Separate from `canUpdate` because publishing is the one edit with a
   * reader-visible consequence: it is the operation the portal serves, and a
   * role may be trusted with drafts without being trusted with that.
   */
  const canPublish = (organizationId: string) =>
    Policy.all(
      Policy.hasMembership(organizationId),
      Policy.canPermission(organizationId, "helpCenterArticles.publish")
    );

  /**
   * Reading one article, or its verdicts, as a member.
   *
   * Membership rather than a content permission: every member can read the
   * documentation, and only a manager can change it. The verdict list is the
   * exception — it is feedback about the documentation, so it stays
   * manager-scoped like the changelog it sits beside.
   */
  const canRead = (organizationId: string) =>
    Policy.hasMembership(organizationId);

  /**
   * True when `topicId` belongs to the workspace.
   *
   * Checked explicitly because the composite foreign key would refuse the row
   * with a 23503, which is a constraint violation and not something an editor
   * can act on. A refused create names the real problem instead.
   */
  const topicBelongsToWorkspace = (args: {
    organizationId: string;
    topicId: string;
  }) =>
    Effect.gen(function* () {
      const owned = yield* topicRepository.findIds({
        organizationId: args.organizationId,
        topicIds: [args.topicId],
      });

      if (owned.length !== 1) {
        return yield* new Policy.PolicyDeniedError({
          reason: "The topic does not belong to this workspace.",
        });
      }
    });

  return {
    canCreate,
    canUpdate,
    canDelete,
    canPublish,
    canRead,
    topicBelongsToWorkspace,
  };
});

export class HelpCenterArticlePolicy extends Context.Service<HelpCenterArticlePolicy>()(
  "HelpCenterArticlePolicy",
  {
    make: makeHelpCenterArticlePolicy,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
