import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

import { NotificationService } from "../notification/service";
import {
  PLAN_ENTITLEMENTS,
  PLAN_FEATURE_CATALOG,
  type LimitFeatureKey,
} from "../plan-entitlements";
import { WorkspaceRepository } from "../workspace/repository";
import type { PlanLockFeatureState } from "./lock";
import { computePlanLockFeatureState } from "./lock";
import {
  demotePlanLockMembers,
  findPlanLockPrivilegedOverLimitOrganizations,
  findPlanLockRecentlyUnentitledSubscriptions,
  findPlanLockSubscriptionsEndingSoon,
  listPlanLockBoards,
  listPlanLockChangelogCategories,
  listPlanLockCrmEntries,
  listPlanLockPrivilegedMembers,
  listPlanLockSelection,
} from "./repository";

/** How often the maintenance pass sweeps. End-of-period notices are days
 * wide, so a pass every few hours is plenty and keeps the queries small. */
const PLAN_LOCK_INTERVAL = Duration.hours(6);

/** The window a plan-ending notice covers, and how far back a locked notice
 * looks for the subscription that ended. Both are generous so a server that
 * was down for a day still sends each notice exactly once. */
const WARNING_WINDOW = Duration.days(7);
const LOOKBACK_WINDOW = Duration.days(7);

const datePlus = (now: Date, duration: Duration.Duration) =>
  DateTime.toDateUtc(
    DateTime.addDuration(DateTime.fromDateUnsafe(now), duration)
  );

const dateMinus = (now: Date, duration: Duration.Duration) =>
  DateTime.toDateUtc(
    DateTime.subtractDuration(DateTime.fromDateUnsafe(now), duration)
  );

const formatDay = (date: Date) => date.toISOString().slice(0, 10);

const featureLabel = (feature: LimitFeatureKey, count: number) => {
  const definition = PLAN_FEATURE_CATALOG[feature];
  const label = count === 1 ? definition.singularLabel : definition.pluralLabel;
  return `${count} ${label.toLowerCase()}`;
};

/** The user ids that can act on a plan change: every privileged member. */
const privilegedRecipients = (organizationId: string) =>
  listPlanLockPrivilegedMembers(organizationId).pipe(
    Effect.map((members) => members.map(({ userId }) => userId))
  );

/** The org-level features' lock states for one workspace, free-plan limits. */
const describeOrganizationLock = Effect.fn("PlanLockMaintenance.describeLock")(
  function* (organizationId: string) {
    const limits = PLAN_ENTITLEMENTS.free.limits;
    const selection = yield* listPlanLockSelection({
      scope: "organization",
      subjectId: organizationId,
    });
    const selectedIds = (feature: LimitFeatureKey) =>
      selection
        .filter((row) => row.featureKey === feature)
        .map(({ resourceId }) => resourceId);

    const [boards, categories, crmEntries, privilegedMembers] =
      yield* Effect.all([
        listPlanLockBoards(organizationId),
        listPlanLockChangelogCategories(organizationId),
        listPlanLockCrmEntries(organizationId),
        listPlanLockPrivilegedMembers(organizationId),
      ]);

    const owners = privilegedMembers.filter((member) =>
      member.role.split(",").includes("owner")
    );
    const admins = privilegedMembers
      .filter((member) => !member.role.split(",").includes("owner"))
      .map(({ id, createdAt }) => ({ id, createdAt }));
    const privilegedLimit = limits.privilegedMembers;

    const features: readonly PlanLockFeatureState[] = [
      computePlanLockFeatureState({
        feature: "feedbackBoards",
        limit: limits.feedbackBoards,
        resources: boards,
        selectedIds: selectedIds("feedbackBoards"),
      }),
      computePlanLockFeatureState({
        feature: "privilegedMembers",
        limit:
          privilegedLimit === null
            ? null
            : Math.max(privilegedLimit - owners.length, 0),
        resources: admins,
        selectedIds: selectedIds("privilegedMembers"),
      }),
      computePlanLockFeatureState({
        feature: "changelogCategories",
        limit: limits.changelogCategories,
        resources: categories,
        selectedIds: selectedIds("changelogCategories"),
      }),
      computePlanLockFeatureState({
        feature: "crmEntries",
        limit: limits.crmEntries,
        resources: crmEntries,
        selectedIds: selectedIds("crmEntries"),
      }),
    ];

    return features;
  }
);

/**
 * One workspace's verdict for the demotion sweep. Returns the admin member
 * ids to demote: the owner always counts as kept, the owner's explicit
 * selection comes next, and the oldest admins fill the remaining slots.
 */
const overLimitAdminIds = Effect.fn("PlanLockMaintenance.overLimitAdminIds")(
  function* (organizationId: string) {
    const members = yield* listPlanLockPrivilegedMembers(organizationId);
    const owners = members.filter((member) =>
      member.role.split(",").includes("owner")
    );
    const admins = members
      .filter((member) => !member.role.split(",").includes("owner"))
      .map(({ id, createdAt }) => ({ id, createdAt }));
    const planLimit = PLAN_ENTITLEMENTS.free.limits.privilegedMembers;
    const selection = yield* listPlanLockSelection({
      scope: "organization",
      subjectId: organizationId,
    });

    const state = computePlanLockFeatureState({
      feature: "privilegedMembers",
      limit: planLimit === null ? null : Math.max(planLimit - owners.length, 0),
      resources: admins,
      selectedIds: selection
        .filter((row) => row.featureKey === "privilegedMembers")
        .map(({ resourceId }) => resourceId),
    });

    return state.lockedIds;
  }
);

/**
 * Demotes every admin beyond the privileged-member cap in one free
 * workspace, then returns the demoted ids. A paid workspace is skipped: its
 * plan does not apply the cap, and a downgrade is caught on a later pass when
 * the plan resolves to free.
 */
const demoteOverLimitAdmins = Effect.fn("PlanLockMaintenance.demoteAdmins")(
  function* (organizationId: string) {
    const workspaceRepository = yield* WorkspaceRepository;
    const { plan } = yield* workspaceRepository.findPlanByOrganizationId({
      organizationId,
    });

    if (plan !== "free") {
      return [];
    }

    const memberIds = yield* overLimitAdminIds(organizationId);
    yield* demotePlanLockMembers(memberIds);
    return [...memberIds];
  }
);

/** Notices for workspaces whose paid period is about to end. */
const notifyEndingSubscriptions = Effect.fn(
  "PlanLockMaintenance.notifyEndingSubscriptions"
)(function* () {
  const notifications = yield* NotificationService;
  const now = yield* DateTime.nowAsDate;
  const subscriptions = yield* findPlanLockSubscriptionsEndingSoon({
    now,
    until: datePlus(now, WARNING_WINDOW),
  });

  yield* Effect.forEach(
    subscriptions,
    (subscription) =>
      Effect.gen(function* () {
        if (subscription.currentPeriodEnd === null) {
          return;
        }

        const recipients = yield* privilegedRecipients(
          subscription.organizationId
        );

        if (recipients.length === 0) {
          return;
        }

        yield* notifications.create({
          body: `After ${formatDay(subscription.currentPeriodEnd)}, anything beyond the Free plan limits becomes read-only. Review what would lock and keep the resources that matter.`,
          deduplicationKey: `plan-ending:${subscription.id}:${subscription.currentPeriodEnd.getTime()}`,
          href: `/${subscription.organizationId}/settings/plan-limits`,
          kind: "plan.ending",
          organizationId: subscription.organizationId,
          recipientUserIds: recipients,
          resourceId: subscription.organizationId,
          resourceType: "workspace",
          title: "Your paid plan ends soon",
        });
      }),
    { concurrency: 4, discard: true }
  );
});

/** One notice per recently finished subscription, describing what locked. */
const notifyLockedSubscriptions = Effect.fn(
  "PlanLockMaintenance.notifyLockedSubscriptions"
)(function* () {
  const notifications = yield* NotificationService;
  const workspaceRepository = yield* WorkspaceRepository;
  const now = yield* DateTime.nowAsDate;
  const subscriptions = yield* findPlanLockRecentlyUnentitledSubscriptions({
    now,
    since: dateMinus(now, LOOKBACK_WINDOW),
  });

  yield* Effect.forEach(
    subscriptions,
    (subscription) =>
      Effect.gen(function* () {
        if (subscription.currentPeriodEnd === null) {
          return;
        }

        // A resubscribe between the end and this pass makes the notice wrong.
        const { plan } = yield* workspaceRepository.findPlanByOrganizationId({
          organizationId: subscription.organizationId,
        });

        if (plan !== "free") {
          return;
        }

        const recipients = yield* privilegedRecipients(
          subscription.organizationId
        );

        if (recipients.length === 0) {
          return;
        }

        const features = yield* describeOrganizationLock(
          subscription.organizationId
        );
        const locked = features.filter(
          (feature) => feature.lockedIds.length > 0
        );

        if (locked.length === 0) {
          return;
        }

        const summary = locked
          .map((feature) =>
            featureLabel(feature.feature, feature.lockedIds.length)
          )
          .join(", ");
        const lockedCount = locked.reduce(
          (total, feature) => total + feature.lockedIds.length,
          0
        );

        yield* notifications.create({
          body: `${summary} became read-only. They stay readable, exportable, and deletable, and everything comes back on a paid plan.`,
          deduplicationKey: `plan-locked:${subscription.organizationId}:${subscription.id}:${subscription.currentPeriodEnd.getTime()}`,
          href: `/${subscription.organizationId}/settings/plan-limits`,
          kind: "plan.locked",
          organizationId: subscription.organizationId,
          recipientUserIds: recipients,
          resourceId: subscription.organizationId,
          resourceType: "workspace",
          title: `Your plan ended — ${lockedCount} ${lockedCount === 1 ? "resource is" : "resources are"} locked`,
        });
      }),
    { concurrency: 4, discard: true }
  );
});

/**
 * The maintenance pass: notify owners about periods that are ending, demote
 * administrators beyond the free cap, and tell owners what the fall to free
 * locked. Notifying runs first so a late resume of a subscription is visible
 * before anything is demoted; the demotion sweep is independent of the
 * subscription rows because a workspace can be over the cap without a
 * recently-ended subscription (for example one created before the cap).
 */
export const runPlanLockMaintenance = Effect.fn("PlanLockMaintenance.runPass")(
  function* () {
    yield* notifyEndingSubscriptions();

    const organizationIds = yield* findPlanLockPrivilegedOverLimitOrganizations(
      PLAN_ENTITLEMENTS.free.limits.privilegedMembers ?? 0
    );
    yield* Effect.forEach(organizationIds, demoteOverLimitAdmins, {
      concurrency: 2,
      discard: true,
    });

    yield* notifyLockedSubscriptions();
  }
);

/**
 * The scheduled half: keeps sweeping for as long as the server runs. Never
 * fails — a database or notification failure is transient and the next pass
 * is the retry. Typed failures and defects are caught separately so
 * interruption still propagates and the loop dies with its scope.
 */
export const planLockMaintenance = runPlanLockMaintenance().pipe(
  Effect.tap(() => Effect.logDebug("Ran the plan lock maintenance pass")),
  Effect.catch((error) =>
    Effect.logError("Plan lock maintenance pass failed", error)
  ),
  Effect.catchDefect((defect) =>
    Effect.logError("Plan lock maintenance pass defected", defect)
  ),
  Effect.repeat(Schedule.spaced(PLAN_LOCK_INTERVAL))
);
