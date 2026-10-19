import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { BoardId, UserId, WorkspaceId } from "@feeblo/id";
import { and, eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { NotificationService } from "../notification/service";
import { WorkspaceRepository } from "../workspace/repository";
import { runPlanLockMaintenance } from "./maintenance";
import { EntitlementPolicy } from "./policies";

const TestLayer = Layer.mergeAll(
  NotificationService.layer,
  WorkspaceRepository.layer,
  EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer))
).pipe(Layer.provideMerge(Database.PgliteDatabaseLive));

const dateAt = (instant: string): Date =>
  DateTime.toDateUtc(DateTime.makeUnsafe(instant));

const makeOrganization = (organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    yield* db.insert(schema.organizationTable).values({
      id: organizationId,
      name: "Maintenance test workspace",
      slug: organizationId,
      createdAt: dateAt("2026-01-01T00:00:00Z"),
    });
  });

const makeUser = (userId: string) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    yield* db.insert(schema.userTable).values({
      id: userId,
      email: `${userId}@example.com`,
      name: "Maintenance test user",
    });
  });

const addMember = (input: {
  readonly createdAt: Date;
  readonly organizationId: string;
  readonly role: "owner" | "admin";
  readonly userId: string;
}) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    yield* db.insert(schema.memberTable).values({
      id: `member_${input.userId}`,
      organizationId: input.organizationId,
      userId: input.userId,
      role: input.role,
      createdAt: input.createdAt,
    });
  });

const addPublicBoards = (organizationId: string, count: number) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    for (let index = 0; index < count; index++) {
      const id = yield* BoardId.generate;
      const createdAt = dateAt(
        `2026-01-${String(index + 2).padStart(2, "0")}T00:00:00Z`
      );
      yield* db.insert(schema.boardTable).values({
        id,
        name: `Board ${index + 1}`,
        slug: id,
        visibility: "PUBLIC",
        organizationId,
        createdAt,
        updatedAt: createdAt,
      });
    }
  });

const addSubscription = (input: {
  readonly cancelAtPeriodEnd: boolean;
  readonly currentPeriodEnd: Date;
  readonly organizationId: string;
  readonly status: "active" | "canceled";
}) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const now = yield* DateTime.nowAsDate;
    const productId = `product_${input.organizationId}`;
    yield* db.insert(schema.productTable).values({
      id: productId,
      name: "Starter",
      isRecurring: true,
      isArchived: false,
      externalOrganizationId: "feeblo",
      visibility: "public",
      metadata: { plan: "starter", variant: "monthly" },
      createdAt: now,
      updatedAt: now,
    });
    yield* db.insert(schema.subscriptionTable).values({
      id: `subscription_${input.organizationId}`,
      externalId: `external_${input.organizationId}`,
      organizationId: input.organizationId,
      amount: 1000,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd,
      currency: "usd",
      recurringInterval: "month",
      recurringIntervalCount: 1,
      status: input.status,
      currentPeriodStart: now,
      currentPeriodEnd: input.currentPeriodEnd,
      customerId: `customer_${input.organizationId}`,
      productId,
      createdAt: now,
      updatedAt: now,
    });
  });

const notificationsFor = (organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    return yield* db
      .select()
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.organizationId, organizationId));
  });

describe("plan lock maintenance", () => {
  layer(TestLayer)("pass", (it) => {
    it.effect(
      "demotes admins beyond the free cap, keeping owner and oldest",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const organizationId = `org_maint_demote_${(yield* WorkspaceId.generate).slice(4)}`;
          const ownerId = `user_maint_owner_${(yield* UserId.generate).slice(4)}`;
          const firstAdminId = `user_maint_admin_a_${(yield* UserId.generate).slice(4)}`;
          const secondAdminId = `user_maint_admin_b_${(yield* UserId.generate).slice(4)}`;
          const thirdAdminId = `user_maint_admin_c_${(yield* UserId.generate).slice(4)}`;

          yield* makeOrganization(organizationId);
          yield* Effect.forEach(
            [ownerId, firstAdminId, secondAdminId, thirdAdminId],
            makeUser,
            { discard: true }
          );
          yield* addMember({
            createdAt: dateAt("2026-01-01T00:00:00Z"),
            organizationId,
            role: "owner",
            userId: ownerId,
          });
          yield* addMember({
            createdAt: dateAt("2026-01-02T00:00:00Z"),
            organizationId,
            role: "admin",
            userId: firstAdminId,
          });
          yield* addMember({
            createdAt: dateAt("2026-01-03T00:00:00Z"),
            organizationId,
            role: "admin",
            userId: secondAdminId,
          });
          yield* addMember({
            createdAt: dateAt("2026-01-04T00:00:00Z"),
            organizationId,
            role: "admin",
            userId: thirdAdminId,
          });

          yield* runPlanLockMaintenance();

          const members = yield* db
            .select({
              userId: schema.memberTable.userId,
              role: schema.memberTable.role,
            })
            .from(schema.memberTable)
            .where(eq(schema.memberTable.organizationId, organizationId));
          const roleByUser = new Map(
            members.map(({ userId: memberUserId, role }) => [
              memberUserId,
              role,
            ])
          );

          expect(roleByUser.get(ownerId)).toBe("owner");
          expect(roleByUser.get(firstAdminId)).toBe("admin");
          expect(roleByUser.get(secondAdminId)).toBe("manager");
          expect(roleByUser.get(thirdAdminId)).toBe("manager");
        })
    );

    it.effect("notifies privileged members before a period ends", () =>
      Effect.gen(function* () {
        const organizationId = `org_maint_ending_${(yield* WorkspaceId.generate).slice(4)}`;
        const ownerId = `user_maint_ending_${(yield* UserId.generate).slice(4)}`;
        const now = yield* DateTime.nowAsDate;

        yield* makeOrganization(organizationId);
        yield* makeUser(ownerId);
        yield* addMember({
          createdAt: now,
          organizationId,
          role: "owner",
          userId: ownerId,
        });
        yield* addSubscription({
          cancelAtPeriodEnd: true,
          currentPeriodEnd: DateTime.toDateUtc(
            DateTime.addDuration(DateTime.fromDateUnsafe(now), Duration.days(3))
          ),
          organizationId,
          status: "active",
        });

        yield* runPlanLockMaintenance();

        const notifications = yield* notificationsFor(organizationId);
        expect(notifications).toHaveLength(1);
        expect(notifications[0]?.kind).toBe("plan.ending");
        expect(notifications[0]?.recipientUserId).toBe(ownerId);

        // The deduplication key makes a second pass a no-op.
        yield* runPlanLockMaintenance();
        expect(yield* notificationsFor(organizationId)).toHaveLength(1);
      })
    );

    it.effect("notifies what locked after a period ends", () =>
      Effect.gen(function* () {
        const organizationId = `org_maint_locked_${(yield* WorkspaceId.generate).slice(4)}`;
        const ownerId = `user_maint_locked_${(yield* UserId.generate).slice(4)}`;
        const now = yield* DateTime.nowAsDate;

        yield* makeOrganization(organizationId);
        yield* makeUser(ownerId);
        yield* addMember({
          createdAt: now,
          organizationId,
          role: "owner",
          userId: ownerId,
        });
        yield* addPublicBoards(organizationId, 3);
        yield* addSubscription({
          cancelAtPeriodEnd: false,
          currentPeriodEnd: DateTime.toDateUtc(
            DateTime.subtractDuration(
              DateTime.fromDateUnsafe(now),
              Duration.days(1)
            )
          ),
          organizationId,
          status: "canceled",
        });

        yield* runPlanLockMaintenance();

        const notifications = yield* notificationsFor(organizationId);
        expect(notifications).toHaveLength(1);
        expect(notifications[0]?.kind).toBe("plan.locked");
        expect(notifications[0]?.body).toContain("1 feedback board");
        expect(notifications[0]?.body).toContain(
          "readable, exportable, and deletable"
        );
      })
    );

    it.effect("leaves a paid workspace over the cap untouched", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const organizationId = `org_maint_paid_${(yield* WorkspaceId.generate).slice(4)}`;
        const ownerId = `user_maint_paid_owner_${(yield* UserId.generate).slice(4)}`;
        const firstAdminId = `user_maint_paid_a_${(yield* UserId.generate).slice(4)}`;
        const secondAdminId = `user_maint_paid_b_${(yield* UserId.generate).slice(4)}`;
        const now = yield* DateTime.nowAsDate;

        yield* makeOrganization(organizationId);
        yield* Effect.forEach(
          [ownerId, firstAdminId, secondAdminId],
          makeUser,
          {
            discard: true,
          }
        );
        yield* addMember({
          createdAt: now,
          organizationId,
          role: "owner",
          userId: ownerId,
        });
        yield* addMember({
          createdAt: now,
          organizationId,
          role: "admin",
          userId: firstAdminId,
        });
        yield* addMember({
          createdAt: now,
          organizationId,
          role: "admin",
          userId: secondAdminId,
        });
        yield* addSubscription({
          cancelAtPeriodEnd: false,
          currentPeriodEnd: DateTime.toDateUtc(
            DateTime.addDuration(
              DateTime.fromDateUnsafe(now),
              Duration.days(30)
            )
          ),
          organizationId,
          status: "active",
        });

        yield* runPlanLockMaintenance();

        const remainingAdmins = yield* db
          .select({ userId: schema.memberTable.userId })
          .from(schema.memberTable)
          .where(
            and(
              eq(schema.memberTable.organizationId, organizationId),
              eq(schema.memberTable.role, "admin")
            )
          );
        expect(remainingAdmins).toHaveLength(2);
      })
    );
  });
});
