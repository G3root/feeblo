import { currentDb, schema, transaction } from "@feeblo/db";
import { PlanLockSelectionId } from "@feeblo/id";
import { PRIVILEGED_ROLES } from "@feeblo/permissions";
import { and, eq, inArray } from "drizzle-orm";
import * as EffectArray from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { LimitFeatureKey } from "../plan-entitlements";
import type { PlanLockSelectionSubject } from "./lock";

/**
 * The persisted side of the plan lock.
 *
 * The lock itself is computed (`./lock.ts`); this module only gathers the
 * resources each limit feature counts and remembers the owner's explicit
 * keeper selection. `scope` picks the column the selection row belongs to:
 * organization-scoped features use `organization_id`, the owner-scoped
 * `workspaces` feature uses `user_id` (both cascade with their subject).
 *
 * These are plain effects that read `currentDb` per call rather than a
 * layered service on purpose. Bundling a new service into
 * `EntitlementPolicy.layer` would add `Database` to that layer's requirements
 * and force every one of its twenty-odd compositions to change; reading the
 * handle per call keeps the database requirement on the three policy methods
 * that actually do the work.
 */

const subjectCondition = (subject: PlanLockSelectionSubject) =>
  subject.scope === "organization"
    ? eq(schema.planLockSelectionTable.organizationId, subject.subjectId)
    : eq(schema.planLockSelectionTable.userId, subject.subjectId);

export const listPlanLockBoards = Effect.fn("PlanLockRepository.listBoards")(
  function* (organizationId: string) {
    const db = yield* currentDb;
    return yield* db
      .select({
        id: schema.boardTable.id,
        createdAt: schema.boardTable.createdAt,
      })
      .from(schema.boardTable)
      .where(
        and(
          eq(schema.boardTable.organizationId, organizationId),
          // Private boards are capability-locked on free, not slot-locked, so
          // they never consume a board slot and never appear in the keeper
          // math; the resolver reports them as locked through `privateBoards`.
          eq(schema.boardTable.visibility, "PUBLIC")
        )
      );
  }
);

export const listPlanLockChangelogCategories = Effect.fn(
  "PlanLockRepository.listChangelogCategories"
)(function* (organizationId: string) {
  const db = yield* currentDb;
  return yield* db
    .select({
      id: schema.changelogCategoryTable.id,
      createdAt: schema.changelogCategoryTable.createdAt,
    })
    .from(schema.changelogCategoryTable)
    .where(eq(schema.changelogCategoryTable.organizationId, organizationId));
});

/**
 * Contacts and companies, the two tables `crmEntries` counts together.
 * Ordering is the lock math's concern; this only gathers ids and creation
 * instants.
 */
export const listPlanLockCrmEntries = Effect.fn(
  "PlanLockRepository.listCrmEntries"
)(function* (organizationId: string) {
  const db = yield* currentDb;
  const [contacts, companies] = yield* Effect.all([
    db
      .select({
        id: schema.contactTable.id,
        createdAt: schema.contactTable.createdAt,
      })
      .from(schema.contactTable)
      .where(eq(schema.contactTable.organizationId, organizationId)),
    db
      .select({
        id: schema.companyTable.id,
        createdAt: schema.companyTable.createdAt,
      })
      .from(schema.companyTable)
      .where(eq(schema.companyTable.organizationId, organizationId)),
  ]);

  return [...contacts, ...companies];
});

/**
 * The rows `countPrivilegedMembers` counts, with the role so the policy can
 * hold owners aside: an owner is never demotable, so the keeper limit for
 * this feature is the plan limit minus the owner count.
 *
 * The predicate is deliberately the same `inArray(role, PRIVILEGED_ROLES)`
 * the counter uses; if the two ever disagree, the lock counts a different set
 * than the gate that blocks creation.
 */
export const listPlanLockPrivilegedMembers = Effect.fn(
  "PlanLockRepository.listPrivilegedMembers"
)(function* (organizationId: string) {
  const db = yield* currentDb;
  return yield* db
    .select({
      id: schema.memberTable.id,
      role: schema.memberTable.role,
      createdAt: schema.memberTable.createdAt,
    })
    .from(schema.memberTable)
    .where(
      and(
        eq(schema.memberTable.organizationId, organizationId),
        inArray(schema.memberTable.role, [...PRIVILEGED_ROLES])
      )
    );
});

/** The owner's keeper selection for one subject, across every feature. */
export const listPlanLockSelection = Effect.fn(
  "PlanLockRepository.listSelection"
)(function* (subject: PlanLockSelectionSubject) {
  const db = yield* currentDb;
  return yield* db
    .select({
      featureKey: schema.planLockSelectionTable.featureKey,
      resourceId: schema.planLockSelectionTable.resourceId,
    })
    .from(schema.planLockSelectionTable)
    .where(subjectCondition(subject));
});

/**
 * The board fields a lock check needs: whether it is over the board count
 * (which only needs the id) and whether it is private (which needs the
 * visibility, because a private board is capability-locked on free no matter
 * how few boards the workspace has).
 */
export const findPlanLockBoard = Effect.fn("PlanLockRepository.findBoard")(
  function* (input: { organizationId: string; boardId: string }) {
    const db = yield* currentDb;
    const rows = yield* db
      .select({
        id: schema.boardTable.id,
        visibility: schema.boardTable.visibility,
      })
      .from(schema.boardTable)
      .where(
        and(
          eq(schema.boardTable.id, input.boardId),
          eq(schema.boardTable.organizationId, input.organizationId)
        )
      )
      .limit(1);

    return Option.getOrUndefined(EffectArray.get(rows, 0));
  }
);

/**
 * Resolves the board a post lives on, so a post-scoped write can check the
 * board lock without the caller having loaded the board.
 */
export const findPlanLockPostBoardId = Effect.fn(
  "PlanLockRepository.findPostBoardId"
)(function* (input: { organizationId: string; postId: string }) {
  const db = yield* currentDb;
  const rows = yield* db
    .select({ boardId: schema.postTable.boardId })
    .from(schema.postTable)
    .where(
      and(
        eq(schema.postTable.id, input.postId),
        eq(schema.postTable.organizationId, input.organizationId)
      )
    )
    .limit(1);

  return Option.getOrUndefined(EffectArray.get(rows, 0))?.boardId;
});

/**
 * Replaces the selection for one feature in one transaction.
 *
 * Delete-then-insert rather than an upsert diff: the selection is a small set
 * the owner rewrites as a whole, and the partial unique indexes enforce
 * `resource_id` per subject and feature. Rows for other features are
 * untouched.
 */
export const replacePlanLockSelection = Effect.fn(
  "PlanLockRepository.replaceSelection"
)(function* (input: {
  readonly subject: PlanLockSelectionSubject;
  readonly featureKey: LimitFeatureKey;
  readonly resourceIds: readonly string[];
}) {
  yield* transaction(
    Effect.gen(function* () {
      const db = yield* currentDb;

      yield* db
        .delete(schema.planLockSelectionTable)
        .where(
          and(
            subjectCondition(input.subject),
            eq(schema.planLockSelectionTable.featureKey, input.featureKey)
          )
        );

      if (input.resourceIds.length === 0) {
        return;
      }

      const rows = yield* Effect.forEach(input.resourceIds, (resourceId) =>
        PlanLockSelectionId.generate.pipe(
          Effect.map((id) => ({
            id,
            organizationId:
              input.subject.scope === "organization"
                ? input.subject.subjectId
                : null,
            userId:
              input.subject.scope === "user" ? input.subject.subjectId : null,
            featureKey: input.featureKey,
            resourceId,
          }))
        )
      );

      yield* db.insert(schema.planLockSelectionTable).values(rows);
    })
  );
});
