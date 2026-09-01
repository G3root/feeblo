import type { TEmailIntentKind } from "@feeblo/db/validation-schema/email";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { PLAN_ENTITLEMENTS } from "../plan-entitlements";
import * as Policy from "../policy";
import { WorkspaceRepository } from "../workspace/repository";

type TCanCreateBoard = {
  organizationId: string;
  visibility: "PUBLIC" | "PRIVATE";
};

type TCanUpdateBoardVisibility = {
  organizationId: string;
};

type TCanHidePoweredByBranding = {
  organizationId: string;
  hidePoweredBy: boolean;
};

type TCanAssignPrivilegedRole = {
  organizationId: string;
};

type TCanCreateRoadmap = {
  organizationId: string;
  visibility: "public" | "private";
};

type TCanCreateChangelogCategory = {
  organizationId: string;
};

type TCanUpdateRoadmapVisibility = {
  organizationId: string;
};

type TCanCreateCrmEntry = {
  organizationId: string;
};

const makeEntitlementPolicy = Effect.gen(function* () {
  const workspaceRepository = yield* WorkspaceRepository;

  const findEntitlements = (organizationId: string) =>
    Effect.gen(function* () {
      const planState = yield* workspaceRepository.findPlanByOrganizationId({
        organizationId,
      });

      return {
        ...planState,
        entitlements: PLAN_ENTITLEMENTS[planState.plan],
      };
    });

  const canUsePrivateBoards = (organizationId: string) =>
    Effect.gen(function* () {
      const { entitlements } = yield* findEntitlements(organizationId);

      if (!entitlements.capabilities.privateBoards) {
        return yield* new Policy.PolicyDeniedError({
          reason: "Private boards require the Starter plan or higher.",
        });
      }
    });

  const canCreateBoard = <E, R>(
    args: TCanCreateBoard & {
      boardCount: Effect.Effect<number, E, R>;
    }
  ) =>
    Effect.gen(function* () {
      const { entitlements, plan } = yield* findEntitlements(
        args.organizationId
      );

      if (
        args.visibility === "PRIVATE" &&
        !entitlements.capabilities.privateBoards
      ) {
        return yield* new Policy.PolicyDeniedError({
          reason: "Private boards require the Starter plan or higher.",
        });
      }

      if (
        entitlements.limits.feedbackBoards !== null &&
        (yield* args.boardCount) >= entitlements.limits.feedbackBoards
      ) {
        return yield* new Policy.PolicyDeniedError({
          reason: `The ${plan} plan allows up to ${entitlements.limits.feedbackBoards} feedback boards.`,
        });
      }
    });

  const canUpdateBoardVisibility = (args: TCanUpdateBoardVisibility) =>
    canUsePrivateBoards(args.organizationId);

  const canUsePrivateRoadmaps = (organizationId: string) =>
    Effect.gen(function* () {
      const { entitlements } = yield* findEntitlements(organizationId);

      if (!entitlements.capabilities.privateRoadmaps) {
        return yield* new Policy.PolicyDeniedError({
          reason: "Private roadmaps require the Starter plan or higher.",
        });
      }
    });

  const canCreateRoadmap = (args: TCanCreateRoadmap) =>
    Effect.gen(function* () {
      if (args.visibility !== "private") {
        return;
      }

      yield* canUsePrivateRoadmaps(args.organizationId);
    });

  const canUpdateRoadmapVisibility = (args: TCanUpdateRoadmapVisibility) =>
    canUsePrivateRoadmaps(args.organizationId);

  const canHidePoweredByBranding = (args: TCanHidePoweredByBranding) =>
    Effect.gen(function* () {
      if (!args.hidePoweredBy) {
        return;
      }

      const { entitlements } = yield* findEntitlements(args.organizationId);

      if (!entitlements.capabilities.removeBranding) {
        return yield* new Policy.PolicyDeniedError({
          reason:
            "Hiding powered by branding requires the Starter plan or higher.",
        });
      }
    });

  const canUseWidgetSso = (organizationId: string) =>
    Effect.gen(function* () {
      const { entitlements } = yield* findEntitlements(organizationId);

      if (!entitlements.capabilities.widgetSso) {
        return yield* new Policy.PolicyDeniedError({
          reason: "Widget SSO requires the Starter plan or higher.",
        });
      }
    });

  const canAssignPrivilegedRole = <E, R>(
    args: TCanAssignPrivilegedRole & {
      privilegedRoleCount: Effect.Effect<number, E, R>;
    }
  ) =>
    Effect.gen(function* () {
      const { entitlements, plan } = yield* findEntitlements(
        args.organizationId
      );

      if (entitlements.limits.privilegedMembers === null) {
        return;
      }

      if (
        (yield* args.privilegedRoleCount) >=
        entitlements.limits.privilegedMembers
      ) {
        return yield* new Policy.PolicyDeniedError({
          reason: `The ${plan} plan allows up to ${entitlements.limits.privilegedMembers} admin roles.`,
        });
      }
    });

  const canCreateChangelogCategory = <E, R>(
    args: TCanCreateChangelogCategory & {
      categoryCount: Effect.Effect<number, E, R>;
    }
  ) =>
    Effect.gen(function* () {
      const { entitlements, plan } = yield* findEntitlements(
        args.organizationId
      );

      if (entitlements.limits.changelogCategories === null) {
        return;
      }

      if (
        (yield* args.categoryCount) >= entitlements.limits.changelogCategories
      ) {
        return yield* new Policy.PolicyDeniedError({
          reason: `The ${plan} plan allows up to ${entitlements.limits.changelogCategories} changelog categories.`,
        });
      }
    });

  const canCreateCrmEntry = <E, R>(
    args: TCanCreateCrmEntry & {
      crmEntryCount: Effect.Effect<number, E, R>;
    }
  ) =>
    Effect.gen(function* () {
      const { entitlements, plan } = yield* findEntitlements(
        args.organizationId
      );

      if (entitlements.limits.crmEntries === null) {
        return;
      }

      if ((yield* args.crmEntryCount) >= entitlements.limits.crmEntries) {
        return yield* new Policy.PolicyDeniedError({
          reason: `The ${plan} plan allows up to ${entitlements.limits.crmEntries} CRM entries.`,
        });
      }
    });

  /** Whether a workspace may create public changelog or post email subscriptions. */
  const mayCreatePublicEmailSubscriptions = Effect.fn(
    "EntitlementPolicy.mayCreatePublicEmailSubscriptions"
  )(function* (organizationId: string) {
    const { entitlements } = yield* findEntitlements(organizationId);
    return entitlements.capabilities.subscriberEmails;
  });

  /** Whether the workspace plan currently permits an email intent to materialize. */
  const mayMaterializeEmailIntent = Effect.fn(
    "EntitlementPolicy.mayMaterializeEmailIntent"
  )(function* ({
    organizationId,
    kind,
  }: {
    readonly organizationId: string;
    readonly kind: TEmailIntentKind;
  }) {
    if (kind === "submission.created") {
      return true;
    }

    const { entitlements } = yield* findEntitlements(organizationId);
    return entitlements.capabilities.subscriberEmails;
  });

  /** Maximum submission-notification recipients, or `null` when unlimited. */
  const submissionNotificationRecipientLimit = Effect.fn(
    "EntitlementPolicy.submissionNotificationRecipientLimit"
  )(function* (organizationId: string) {
    const { entitlements } = yield* findEntitlements(organizationId);
    return entitlements.limits.submissionNotificationRecipients;
  });

  /** Whether the workspace plan currently permits Slack, Discord, and GitHub integrations. */
  const mayUseIntegrations = Effect.fn("EntitlementPolicy.mayUseIntegrations")(
    function* (organizationId: string) {
      const { entitlements } = yield* findEntitlements(organizationId);
      return entitlements.capabilities.integrations;
    }
  );

  /**
   * Policy gate denying new Slack, Discord, and GitHub connections on plans
   * without integrations. Database failures surface as `EffectDrizzleQueryError`
   * for the caller's boundary to remap.
   */
  const canUseIntegrations = (organizationId: string) =>
    Effect.flatMap(mayUseIntegrations(organizationId), (allowed) =>
      allowed
        ? Effect.void
        : Effect.fail(
            new Policy.PolicyDeniedError({
              reason: "Integrations require the Starter plan or higher.",
            })
          )
    );

  /**
   * Derived downgrade view for a workspace: whether the free plan now holds
   * integration connections it can no longer use, and whether a paid plan is
   * scheduled to end at the current period boundary. Never persisted; every
   * call re-derives the state from the subscription row and live counts.
   */
  const getDowngradeState = Effect.fn("EntitlementPolicy.getDowngradeState")(
    function* (organizationId: string) {
      const planState = yield* workspaceRepository.findPlanByOrganizationId({
        organizationId,
      });
      const integrationCount =
        yield* workspaceRepository.countPlanGatedIntegrationConnections({
          organizationId,
        });
      const entitlements = PLAN_ENTITLEMENTS[planState.plan];

      const subscription = planState.subscription;
      const scheduledDowngrade =
        subscription?.status === "active" &&
        subscription.cancelAtPeriodEnd &&
        subscription.currentPeriodEnd !== null
          ? {
              cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
              currentPeriodEnd: subscription.currentPeriodEnd,
            }
          : null;

      return {
        integrationCount,
        integrationLimit: entitlements.capabilities.integrations ? null : 0,
        isDowngraded: planState.plan === "free" && integrationCount > 0,
        plan: planState.plan,
        scheduledDowngrade,
      };
    }
  );

  return {
    canCreateBoard,
    canUpdateBoardVisibility,
    canHidePoweredByBranding,
    canUseWidgetSso,
    canAssignPrivilegedRole,
    canCreateRoadmap,
    canUpdateRoadmapVisibility,
    canCreateChangelogCategory,
    canCreateCrmEntry,
    mayCreatePublicEmailSubscriptions,
    mayMaterializeEmailIntent,
    submissionNotificationRecipientLimit,
    mayUseIntegrations,
    canUseIntegrations,
    getDowngradeState,
  };
});

export class EntitlementPolicy extends Context.Service<EntitlementPolicy>()(
  "EntitlementPolicy",
  {
    make: makeEntitlementPolicy,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
