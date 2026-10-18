import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { BoardId, UserId, WorkspaceId } from "@feeblo/id";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { LimitFeatureKey } from "../plan-entitlements";
import { WorkspaceRepository } from "../workspace/repository";
import type { PlanLockState } from "./lock";
import { EntitlementPolicy } from "./policies";

/** The `Date` for a known instant, built through `DateTime`. */
const dateAt = (instant: string): Date =>
  DateTime.toDateUtc(DateTime.makeUnsafe(instant));

const TestLayer = EntitlementPolicy.layer.pipe(
  Layer.provide(WorkspaceRepository.layer),
  Layer.provideMerge(Database.PgliteDatabaseLive)
);

const makeUser = Effect.gen(function* () {
  const db = yield* currentDb;
  const userId = yield* UserId.generate;

  yield* db.insert(schema.userTable).values({
    id: userId,
    email: `${userId}@example.com`,
    name: "Plan lock test user",
  });

  return userId;
});

const makeWorkspaceOwnedBy = (userId: string, createdAt: Date) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const organizationId = yield* WorkspaceId.generate;

    yield* db.insert(schema.organizationTable).values({
      id: organizationId,
      name: "Plan lock workspace",
      slug: organizationId,
      createdAt,
    });
    yield* db.insert(schema.memberTable).values({
      id: `member_${organizationId}`,
      organizationId,
      userId,
      role: "owner",
      createdAt,
    });

    return organizationId;
  });

const makeWorkspace = Effect.gen(function* () {
  const userId = yield* makeUser;
  const organizationId = yield* makeWorkspaceOwnedBy(
    userId,
    dateAt("2026-01-01T00:00:00Z")
  );

  return { organizationId, userId };
});

const addBoard = (
  organizationId: string,
  createdAt: Date,
  visibility: "PUBLIC" | "PRIVATE" = "PUBLIC"
) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const id = yield* BoardId.generate;

    yield* db.insert(schema.boardTable).values({
      id,
      name: `Board ${id}`,
      slug: id,
      visibility,
      organizationId,
      createdAt,
      updatedAt: createdAt,
    });

    return id;
  });

const addChangelogCategory = (organizationId: string, createdAt: Date) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const id = `category_${(yield* BoardId.generate).slice(4)}`;

    yield* db.insert(schema.changelogCategoryTable).values({
      id,
      name: id,
      icon: "circle",
      organizationId,
      createdAt,
      updatedAt: createdAt,
    });

    return id;
  });

const addContact = (organizationId: string, createdAt: Date) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const id = `contact_${(yield* BoardId.generate).slice(4)}`;

    yield* db.insert(schema.contactTable).values({
      id,
      organizationId,
      createdAt,
      updatedAt: createdAt,
    });

    return id;
  });

const addPrivilegedMember = (organizationId: string, createdAt: Date) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const userId = yield* makeUser;
    const id = `member_admin_${userId}`;

    yield* db.insert(schema.memberTable).values({
      id,
      organizationId,
      userId,
      role: "admin",
      createdAt,
    });

    return id;
  });

const addActiveSubscription = (
  organizationId: string,
  plan: "starter" | "professional"
) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const now = yield* DateTime.nowAsDate;
    const productId = `product_${plan}_${organizationId}`;

    yield* db.insert(schema.productTable).values({
      id: productId,
      name: plan,
      isRecurring: true,
      isArchived: false,
      externalOrganizationId: "feeblo",
      visibility: "public",
      metadata: { plan, variant: "monthly" },
      createdAt: now,
      updatedAt: now,
    });
    yield* db.insert(schema.subscriptionTable).values({
      id: `subscription_${organizationId}`,
      externalId: `external_${organizationId}`,
      organizationId,
      amount: 1000,
      cancelAtPeriodEnd: false,
      currency: "usd",
      recurringInterval: "month",
      recurringIntervalCount: 1,
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: dateAt("2099-01-01T00:00:00Z"),
      customerId: `customer_${organizationId}`,
      productId,
      createdAt: now,
      updatedAt: now,
    });
  });

const feature = (state: PlanLockState, key: LimitFeatureKey) => {
  const found = state.features.find((entry) => entry.feature === key);
  if (found === undefined) {
    throw new Error(`Missing feature ${key}`);
  }
  return found;
};

describe("plan lock policy", () => {
  layer(TestLayer)("plan-aware lock state", (it) => {
    it.effect("locks boards beyond the free limit and keeps the oldest", () =>
      Effect.gen(function* () {
        const policy = yield* EntitlementPolicy;
        const { organizationId, userId } = yield* makeWorkspace;

        const oldest = yield* addBoard(
          organizationId,
          dateAt("2026-01-01T00:00:00Z")
        );
        const middle = yield* addBoard(
          organizationId,
          dateAt("2026-01-02T00:00:00Z")
        );
        const newest = yield* addBoard(
          organizationId,
          dateAt("2026-01-03T00:00:00Z")
        );

        const state = yield* policy.getPlanLock({ organizationId, userId });

        expect(state.plan).toBe("free");
        expect(feature(state, "feedbackBoards")).toEqual({
          feature: "feedbackBoards",
          limit: 2,
          count: 3,
          keptIds: [oldest, middle],
          lockedIds: [newest],
        });
      })
    );

    it.effect(
      "keeps everything on a paid plan and previews the free lock",
      () =>
        Effect.gen(function* () {
          const policy = yield* EntitlementPolicy;
          const { organizationId, userId } = yield* makeWorkspace;

          yield* addBoard(organizationId, dateAt("2026-01-01T00:00:00Z"));
          yield* addBoard(organizationId, dateAt("2026-01-02T00:00:00Z"));
          const newest = yield* addBoard(
            organizationId,
            dateAt("2026-01-03T00:00:00Z")
          );
          yield* addActiveSubscription(organizationId, "starter");

          const current = yield* policy.getPlanLock({ organizationId, userId });
          const preview = yield* policy.getPlanLockPreview({
            organizationId,
            userId,
          });

          expect(current.plan).toBe("starter");
          expect(feature(current, "feedbackBoards").lockedIds).toEqual([]);
          expect(preview.plan).toBe("free");
          expect(feature(preview, "feedbackBoards").lockedIds).toEqual([
            newest,
          ]);
        })
    );

    it.effect(
      "lets an explicit selection override the oldest-first default",
      () =>
        Effect.gen(function* () {
          const policy = yield* EntitlementPolicy;
          const { organizationId, userId } = yield* makeWorkspace;

          const oldest = yield* addBoard(
            organizationId,
            dateAt("2026-01-01T00:00:00Z")
          );
          const middle = yield* addBoard(
            organizationId,
            dateAt("2026-01-02T00:00:00Z")
          );
          const newest = yield* addBoard(
            organizationId,
            dateAt("2026-01-03T00:00:00Z")
          );

          yield* policy.setPlanLockSelection({
            organizationId,
            userId,
            featureKey: "feedbackBoards",
            resourceIds: [newest],
          });

          const state = yield* policy.getPlanLock({ organizationId, userId });

          expect(feature(state, "feedbackBoards")).toEqual({
            feature: "feedbackBoards",
            limit: 2,
            count: 3,
            keptIds: [newest, oldest],
            lockedIds: [middle],
          });
        })
    );

    it.effect("rejects a selection naming a foreign resource", () =>
      Effect.gen(function* () {
        const policy = yield* EntitlementPolicy;
        const { organizationId, userId } = yield* makeWorkspace;

        yield* addBoard(organizationId, dateAt("2026-01-01T00:00:00Z"));

        const error = yield* Effect.flip(
          policy.setPlanLockSelection({
            organizationId,
            userId,
            featureKey: "feedbackBoards",
            resourceIds: ["brd_not_in_this_workspace"],
          })
        );

        expect(error._tag).toBe("PolicyDenied");
      })
    );

    it.effect("rejects more keepers than the free limit allows", () =>
      Effect.gen(function* () {
        const policy = yield* EntitlementPolicy;
        const { organizationId, userId } = yield* makeWorkspace;

        const first = yield* addBoard(
          organizationId,
          dateAt("2026-01-01T00:00:00Z")
        );
        const second = yield* addBoard(
          organizationId,
          dateAt("2026-01-02T00:00:00Z")
        );
        const third = yield* addBoard(
          organizationId,
          dateAt("2026-01-03T00:00:00Z")
        );

        const error = yield* Effect.flip(
          policy.setPlanLockSelection({
            organizationId,
            userId,
            featureKey: "feedbackBoards",
            resourceIds: [first, second, third],
          })
        );

        expect(error._tag).toBe("PolicyDenied");
      })
    );

    it.effect("holds owners aside from the admin keeper limit", () =>
      Effect.gen(function* () {
        const policy = yield* EntitlementPolicy;
        const { organizationId, userId } = yield* makeWorkspace;

        const firstAdmin = yield* addPrivilegedMember(
          organizationId,
          dateAt("2026-02-01T00:00:00Z")
        );
        const secondAdmin = yield* addPrivilegedMember(
          organizationId,
          dateAt("2026-02-02T00:00:00Z")
        );

        const state = yield* policy.getPlanLock({ organizationId, userId });

        // The owner counts against the plan's two privileged members, so the
        // keeper limit for admins is one and the newest admin is locked.
        expect(feature(state, "privilegedMembers")).toEqual({
          feature: "privilegedMembers",
          limit: 1,
          count: 2,
          keptIds: [firstAdmin],
          lockedIds: [secondAdmin],
        });
      })
    );

    it.effect("locks the newest free workspace beyond the owner cap", () =>
      Effect.gen(function* () {
        const policy = yield* EntitlementPolicy;
        const userId = yield* makeUser;

        const first = yield* makeWorkspaceOwnedBy(
          userId,
          dateAt("2026-01-01T00:00:00Z")
        );
        const second = yield* makeWorkspaceOwnedBy(
          userId,
          dateAt("2026-01-02T00:00:00Z")
        );
        const third = yield* makeWorkspaceOwnedBy(
          userId,
          dateAt("2026-01-03T00:00:00Z")
        );
        const fourth = yield* makeWorkspaceOwnedBy(
          userId,
          dateAt("2026-01-04T00:00:00Z")
        );

        const state = yield* policy.getPlanLock({
          organizationId: first,
          userId,
        });

        expect(feature(state, "workspaces")).toEqual({
          feature: "workspaces",
          limit: 3,
          count: 4,
          keptIds: [first, second, third],
          lockedIds: [fourth],
        });
      })
    );

    it.effect(
      "counts the previewed workspace as free while it is still paid",
      () =>
        Effect.gen(function* () {
          const policy = yield* EntitlementPolicy;
          const userId = yield* makeUser;

          const target = yield* makeWorkspaceOwnedBy(
            userId,
            dateAt("2026-01-01T00:00:00Z")
          );
          const second = yield* makeWorkspaceOwnedBy(
            userId,
            dateAt("2026-01-02T00:00:00Z")
          );
          const third = yield* makeWorkspaceOwnedBy(
            userId,
            dateAt("2026-01-03T00:00:00Z")
          );
          const fourth = yield* makeWorkspaceOwnedBy(
            userId,
            dateAt("2026-01-04T00:00:00Z")
          );
          yield* addActiveSubscription(target, "starter");

          const preview = yield* policy.getPlanLockPreview({
            organizationId: target,
            userId,
          });

          // The target workspace is still paid today, but the preview of the
          // downgrade has to count it with its free siblings, not behind them.
          expect(feature(preview, "workspaces")).toEqual({
            feature: "workspaces",
            limit: 3,
            count: 4,
            keptIds: [target, second, third],
            lockedIds: [fourth],
          });
        })
    );

    it.effect("refuses a write to a locked board but not to a kept one", () =>
      Effect.gen(function* () {
        const policy = yield* EntitlementPolicy;
        const { organizationId } = yield* makeWorkspace;

        const oldest = yield* addBoard(
          organizationId,
          dateAt("2026-01-01T00:00:00Z")
        );
        yield* addBoard(organizationId, dateAt("2026-01-02T00:00:00Z"));
        const newest = yield* addBoard(
          organizationId,
          dateAt("2026-01-03T00:00:00Z")
        );

        yield* policy.assertBoardWritable({ boardId: oldest, organizationId });

        const error = yield* Effect.flip(
          policy.assertBoardWritable({ boardId: newest, organizationId })
        );
        expect(error._tag).toBe("PlanLockedError");
      })
    );

    it.effect("unlocks a board the owner selected to keep", () =>
      Effect.gen(function* () {
        const policy = yield* EntitlementPolicy;
        const { organizationId, userId } = yield* makeWorkspace;

        yield* addBoard(organizationId, dateAt("2026-01-01T00:00:00Z"));
        yield* addBoard(organizationId, dateAt("2026-01-02T00:00:00Z"));
        const newest = yield* addBoard(
          organizationId,
          dateAt("2026-01-03T00:00:00Z")
        );

        yield* policy.setPlanLockSelection({
          featureKey: "feedbackBoards",
          organizationId,
          resourceIds: [newest],
          userId,
        });

        yield* policy.assertBoardWritable({
          boardId: newest,
          organizationId,
        });
      })
    );

    it.effect(
      "locks a private board on free but allows publishing it into a slot",
      () =>
        Effect.gen(function* () {
          const policy = yield* EntitlementPolicy;
          const { organizationId } = yield* makeWorkspace;

          const privateBoard = yield* addBoard(
            organizationId,
            dateAt("2026-01-01T00:00:00Z"),
            "PRIVATE"
          );

          const error = yield* Effect.flip(
            policy.assertBoardWritable({
              boardId: privateBoard,
              organizationId,
            })
          );
          expect(error._tag).toBe("PlanLockedError");
          // The `feature` field is on the tag branch; `message` is on both, so
          // the assertion can read it without a narrowing that the error
          // union's unrelated driver member does not support.
          expect("message" in error ? error.message : "").toContain("private");

          yield* policy.assertBoardWritable({
            boardId: privateBoard,
            nextVisibility: "PUBLIC",
            organizationId,
          });
        })
    );

    it.effect("refuses a post write when its board is locked", () =>
      Effect.gen(function* () {
        const policy = yield* EntitlementPolicy;
        const db = yield* currentDb;
        const { organizationId } = yield* makeWorkspace;

        const lockedBoard = yield* addBoard(
          organizationId,
          dateAt("2026-01-03T00:00:00Z")
        );
        yield* addBoard(organizationId, dateAt("2026-01-01T00:00:00Z"));
        yield* addBoard(organizationId, dateAt("2026-01-02T00:00:00Z"));

        const postId = `post_${lockedBoard}`;
        const statusId = `status_${organizationId}`;
        const createdAt = dateAt("2026-01-03T00:00:00Z");
        yield* db.insert(schema.postStatusTable).values({
          id: statusId,
          type: "PENDING",
          orderIndex: 0,
          organizationId,
        });
        yield* db.insert(schema.postTable).values({
          id: postId,
          boardId: lockedBoard,
          organizationId,
          title: "Locked post",
          content: "Content",
          slug: postId,
          statusId,
          createdAt,
          updatedAt: createdAt,
        });

        const error = yield* Effect.flip(
          policy.assertPostBoardWritable({ organizationId, postId })
        );
        expect(error._tag).toBe("PlanLockedError");
      })
    );

    it.effect("refuses a write to an over-limit changelog category", () =>
      Effect.gen(function* () {
        const policy = yield* EntitlementPolicy;
        const { organizationId } = yield* makeWorkspace;

        for (const day of [1, 2, 3]) {
          yield* addChangelogCategory(
            organizationId,
            dateAt(`2026-01-0${day}T00:00:00Z`)
          );
        }
        const fourth = yield* addChangelogCategory(
          organizationId,
          dateAt("2026-01-04T00:00:00Z")
        );

        const error = yield* Effect.flip(
          policy.assertChangelogCategoryWritable({
            categoryId: fourth,
            organizationId,
          })
        );
        expect(error._tag).toBe("PlanLockedError");
      })
    );

    it.effect("refuses a write to an over-limit CRM entry", () =>
      Effect.gen(function* () {
        const policy = yield* EntitlementPolicy;
        const { organizationId } = yield* makeWorkspace;

        for (let index = 0; index < 10; index++) {
          yield* addContact(
            organizationId,
            dateAt(`2026-01-${String(index + 1).padStart(2, "0")}T00:00:00Z`)
          );
        }
        const eleventh = yield* addContact(
          organizationId,
          dateAt("2026-02-01T00:00:00Z")
        );

        const error = yield* Effect.flip(
          policy.assertCrmEntryWritable({
            organizationId,
            resourceId: eleventh,
          })
        );
        expect(error._tag).toBe("PlanLockedError");
      })
    );
  });
});
