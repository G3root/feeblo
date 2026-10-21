import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  BoardId,
  ChangelogCategoryId,
  CompanyId,
  ContactId,
  PostId,
  PostStatusId,
  RoadmapId,
  WorkspaceId,
} from "@feeblo/id";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { BoardRepository } from "../board/repository";
import { ChangelogCategoryRepository } from "../changelog-category/repository";
import { CompanyRepository } from "../company/repository";
import { ContactRepository } from "../contact/repository";
import { MembershipRepository } from "../membership/repository";
import { PostRepository } from "../post/repository";
import { RoadmapRepository } from "../roadmap/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { PlanCompliance } from "./compliance";
import type {
  TPlanComplianceViolation,
  TWorkspacePlanCompliance,
} from "./schema";

const dateAt = (instant: string | number | Date): Date =>
  DateTime.toDateUtc(DateTime.makeUnsafe(instant));

const RepositoriesTest = Layer.mergeAll(
  BoardRepository.layer,
  ChangelogCategoryRepository.layer,
  CompanyRepository.layer,
  ContactRepository.layer,
  MembershipRepository.layer,
  PostRepository.layer,
  RoadmapRepository.layer,
  WorkspaceRepository.layer
);

const TestLayer = PlanCompliance.layer.pipe(
  Layer.provide(RepositoriesTest),
  Layer.provideMerge(Database.PgliteDatabaseLive)
);

const makeOrganization = () =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const organizationId = yield* WorkspaceId.generate;
    const now = yield* DateTime.nowAsDate;
    const ownerId = `user_owner_${organizationId}`;

    yield* db.insert(schema.organizationTable).values({
      id: organizationId,
      name: "Test workspace",
      slug: organizationId,
      createdAt: now,
    });
    yield* db.insert(schema.userTable).values({
      id: ownerId,
      email: `${organizationId}-owner@example.com`,
      name: "Workspace Owner",
    });
    yield* db.insert(schema.memberTable).values({
      id: `member_owner_${organizationId}`,
      organizationId,
      userId: ownerId,
      role: "owner",
      createdAt: now,
    });

    return { now, organizationId, ownerId };
  });

const addPlan = (organizationId: string, plan: "starter" | "professional") =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const now = yield* DateTime.nowAsDate;
    const productId = `product_${organizationId}`;

    yield* db.insert(schema.productTable).values({
      id: productId,
      name: `${plan} monthly`,
      isRecurring: true,
      isArchived: false,
      externalOrganizationId: "feeblo",
      visibility: "public",
      recurringInterval: "month",
      recurringIntervalCount: 1,
      metadata: { plan, variant: "monthly" },
      createdAt: now,
      updatedAt: now,
    });
    yield* db.insert(schema.subscriptionTable).values({
      id: `subscription_${organizationId}`,
      externalId: `external_${organizationId}`,
      organizationId,
      amount: 2900,
      cancelAtPeriodEnd: false,
      currency: "usd",
      recurringInterval: "month",
      recurringIntervalCount: 1,
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: dateAt(now.getTime() + 86_400_000),
      customerId: `customer_${organizationId}`,
      productId,
      createdAt: now,
      updatedAt: now,
    });
  });

const addBoard = (
  organizationId: string,
  name: string,
  visibility: "PUBLIC" | "PRIVATE"
) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const id = yield* BoardId.generate;
    const now = yield* DateTime.nowAsDate;

    yield* db.insert(schema.boardTable).values({
      id,
      name,
      slug: id,
      visibility,
      organizationId,
      createdAt: now,
      updatedAt: now,
    });

    return id;
  });

const addRoadmap = (
  organizationId: string,
  name: string,
  visibility: "public" | "private"
) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const id = yield* RoadmapId.generate;
    const now = yield* DateTime.nowAsDate;

    yield* db.insert(schema.roadmapTable).values({
      id,
      name,
      slug: id,
      isPrimary: false,
      mode: "status",
      visibility,
      filter: { version: 1, operator: "and", conditions: [] },
      organizationId,
      createdAt: now,
      updatedAt: now,
    });

    return id;
  });

const addCategory = (organizationId: string, name: string) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const id = yield* ChangelogCategoryId.generate;

    yield* db.insert(schema.changelogCategoryTable).values({
      id,
      name,
      icon: "icon",
      organizationId,
    });

    return id;
  });

const addContact = (organizationId: string, name: string) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const id = yield* ContactId.generate;

    yield* db.insert(schema.contactTable).values({
      id,
      name,
      email: `${id}@example.com`,
      organizationId,
    });

    return id;
  });

const addCompany = (organizationId: string, name: string) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const id = yield* CompanyId.generate;

    yield* db.insert(schema.companyTable).values({
      id,
      name,
      organizationId,
    });

    return id;
  });

const addMember = (
  organizationId: string,
  role: (typeof schema.memberTable.$inferInsert)["role"]
) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const userId = `user_member_${organizationId}`;
    const now = yield* DateTime.nowAsDate;

    yield* db.insert(schema.userTable).values({
      id: userId,
      email: `${userId}@example.com`,
      name: "Workspace Member",
    });
    yield* db.insert(schema.memberTable).values({
      id: `member_${userId}`,
      organizationId,
      userId,
      role,
      createdAt: now,
    });
  });

const addInvitation = (
  organizationId: string,
  inviterId: string,
  role: (typeof schema.invitationTable.$inferInsert)["role"]
) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const now = yield* DateTime.nowAsDate;

    yield* db.insert(schema.invitationTable).values({
      id: `invitation_${organizationId}`,
      organizationId,
      email: `invitee_${organizationId}@example.com`,
      role,
      status: "pending",
      expiresAt: dateAt(now.getTime() + 86_400_000),
      inviterId,
      createdAt: now,
    });
  });

const addPost = (organizationId: string, boardId: string, title: string) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const id = yield* PostId.generate;
    const statusId = yield* PostStatusId.generate;
    const now = yield* DateTime.nowAsDate;

    yield* db.insert(schema.postStatusTable).values({
      id: statusId,
      type: "PENDING",
      orderIndex: 0,
      organizationId,
    });
    yield* db.insert(schema.postTable).values({
      id,
      title,
      slug: id,
      content: title,
      boardId,
      statusId,
      organizationId,
      createdAt: now,
      updatedAt: now,
    });

    return id;
  });

const byKind = (
  snapshot: TWorkspacePlanCompliance,
  kind: TPlanComplianceViolation["kind"]
) => snapshot.violations.find((violation) => violation.kind === kind);

describe("PlanCompliance", () => {
  layer(TestLayer)("over-plan snapshot", (it) => {
    it.effect("reports nothing for a compliant free workspace", () =>
      Effect.gen(function* () {
        const planCompliance = yield* PlanCompliance;
        const { organizationId } = yield* makeOrganization();

        const snapshot = yield* planCompliance.snapshot({
          includeResources: true,
          organizationId,
        });

        expect(snapshot.plan).toBe("free");
        expect(snapshot.violations).toEqual([]);
        expect(snapshot.degraded).toEqual([
          "integrations",
          "publicApi",
          "removeBranding",
          "widgetSso",
          "subscriberEmails",
        ]);
      })
    );

    it.effect("counts a private board on Free as over plan", () =>
      Effect.gen(function* () {
        const planCompliance = yield* PlanCompliance;
        const { organizationId } = yield* makeOrganization();
        yield* addBoard(organizationId, "Private board", "PRIVATE");

        const snapshot = yield* planCompliance.snapshot({
          includeResources: true,
          organizationId,
        });
        const privateBoards = byKind(snapshot, "privateBoards");

        expect(privateBoards?.count).toBe(1);
        expect(privateBoards?.limit).toBeNull();
        expect(
          privateBoards?.resources.map((resource) => resource.label)
        ).toEqual(["Private board"]);
        expect(byKind(snapshot, "boards")).toBeUndefined();
      })
    );

    it.effect("reports the exact limit as inside the plan", () =>
      Effect.gen(function* () {
        const planCompliance = yield* PlanCompliance;
        const { organizationId } = yield* makeOrganization();
        yield* addBoard(organizationId, "First", "PUBLIC");
        yield* addBoard(organizationId, "Second", "PUBLIC");

        const snapshot = yield* planCompliance.snapshot({
          includeResources: true,
          organizationId,
        });

        expect(byKind(snapshot, "boards")).toBeUndefined();
      })
    );

    it.effect("reports boards over the limit with every candidate row", () =>
      Effect.gen(function* () {
        const planCompliance = yield* PlanCompliance;
        const { organizationId } = yield* makeOrganization();
        yield* addBoard(organizationId, "Public one", "PUBLIC");
        yield* addBoard(organizationId, "Public two", "PUBLIC");
        yield* addBoard(organizationId, "Private one", "PRIVATE");

        const snapshot = yield* planCompliance.snapshot({
          includeResources: true,
          organizationId,
        });
        const boards = byKind(snapshot, "boards");
        const privateBoards = byKind(snapshot, "privateBoards");

        expect(boards?.count).toBe(3);
        expect(boards?.limit).toBe(2);
        expect(boards?.resources).toHaveLength(3);
        expect(
          privateBoards?.resources.map((resource) => resource.label)
        ).toEqual(["Private one"]);
      })
    );

    it.effect("counts a board's posts in its preview row", () =>
      Effect.gen(function* () {
        const planCompliance = yield* PlanCompliance;
        const { organizationId } = yield* makeOrganization();
        yield* addBoard(organizationId, "Quiet board", "PUBLIC");
        yield* addBoard(organizationId, "Public two", "PUBLIC");
        const busyBoardId = yield* addBoard(
          organizationId,
          "Busy board",
          "PUBLIC"
        );
        yield* addPost(organizationId, busyBoardId, "A post");

        const snapshot = yield* planCompliance.snapshot({
          includeResources: true,
          organizationId,
        });
        const resources = byKind(snapshot, "boards")?.resources ?? [];

        expect(
          resources.find((resource) => resource.label === "Busy board")?.detail
        ).toBe("1 post");
        expect(
          resources.find((resource) => resource.label === "Quiet board")?.detail
        ).toBe("0 posts");
      })
    );

    it.effect(
      "previews private boards that fall outside the general board page",
      () =>
        Effect.gen(function* () {
          const planCompliance = yield* PlanCompliance;
          const { now, organizationId } = yield* makeOrganization();
          const db = yield* currentDb;

          const boardRows = Array.from({ length: 201 }, (_, index) => ({
            id: `board_${organizationId}_${index}`,
            name: index === 200 ? "Hidden board" : `Board ${index}`,
            slug: `board_${organizationId}_${index}`,
            visibility:
              index === 200 ? ("PRIVATE" as const) : ("PUBLIC" as const),
            organizationId,
            createdAt: now,
            updatedAt: now,
          }));

          yield* db.insert(schema.boardTable).values(boardRows);

          const snapshot = yield* planCompliance.snapshot({
            includeResources: true,
            organizationId,
          });
          const privateBoards = byKind(snapshot, "privateBoards");

          // The private board is the 201st row, outside the 200-row general
          // preview. It still has to appear in the finding it belongs to.
          expect(byKind(snapshot, "boards")?.resources).toHaveLength(200);
          expect(
            byKind(snapshot, "boards")?.resources.some(
              (resource) => resource.label === "Hidden board"
            )
          ).toBe(false);
          expect(privateBoards?.count).toBe(1);
          expect(
            privateBoards?.resources.map((resource) => resource.label)
          ).toEqual(["Hidden board"]);
        })
    );

    it.effect("withholds resource rows from a caller who cannot act", () =>
      Effect.gen(function* () {
        const planCompliance = yield* PlanCompliance;
        const { organizationId } = yield* makeOrganization();
        yield* addBoard(organizationId, "Public one", "PUBLIC");
        yield* addBoard(organizationId, "Public two", "PUBLIC");
        yield* addBoard(organizationId, "Private one", "PRIVATE");

        const snapshot = yield* planCompliance.snapshot({
          includeResources: false,
          organizationId,
        });

        expect(byKind(snapshot, "boards")?.count).toBe(3);
        expect(byKind(snapshot, "boards")?.resources).toEqual([]);
        expect(byKind(snapshot, "privateBoards")?.resources).toEqual([]);
      })
    );

    it.effect(
      "counts every member with pending invitations, whatever the role",
      () =>
        Effect.gen(function* () {
          const planCompliance = yield* PlanCompliance;
          const { organizationId, ownerId } = yield* makeOrganization();
          yield* addMember(organizationId, "manager");
          yield* addInvitation(organizationId, ownerId, "contributor");

          const snapshot = yield* planCompliance.snapshot({
            includeResources: true,
            organizationId,
          });
          const members = byKind(snapshot, "members");

          expect(members?.count).toBe(3);
          expect(members?.limit).toBe(2);
          expect(
            members?.resources.map((resource) => resource.detail).sort()
          ).toEqual(["Manager", "Owner", "Pending invitation · Contributor"]);
        })
    );

    it.effect("counts a private roadmap on Free and leaves Starter alone", () =>
      Effect.gen(function* () {
        const planCompliance = yield* PlanCompliance;
        const free = yield* makeOrganization();
        const starter = yield* makeOrganization();
        yield* addPlan(starter.organizationId, "starter");

        yield* addRoadmap(free.organizationId, "Secret roadmap", "private");
        yield* addRoadmap(starter.organizationId, "Private roadmap", "private");

        const freeSnapshot = yield* planCompliance.snapshot({
          includeResources: true,
          organizationId: free.organizationId,
        });
        const starterSnapshot = yield* planCompliance.snapshot({
          includeResources: true,
          organizationId: starter.organizationId,
        });

        expect(byKind(freeSnapshot, "privateRoadmaps")?.count).toBe(1);
        expect(byKind(starterSnapshot, "privateRoadmaps")).toBeUndefined();
      })
    );

    it.effect("counts changelog categories and their linked entries", () =>
      Effect.gen(function* () {
        const planCompliance = yield* PlanCompliance;
        const { organizationId } = yield* makeOrganization();
        yield* addCategory(organizationId, "One");
        yield* addCategory(organizationId, "Two");
        yield* addCategory(organizationId, "Three");
        yield* addCategory(organizationId, "Four");

        const snapshot = yield* planCompliance.snapshot({
          includeResources: true,
          organizationId,
        });
        const categories = byKind(snapshot, "changelogCategories");

        expect(categories?.count).toBe(4);
        expect(categories?.limit).toBe(3);
        expect(categories?.resources).toHaveLength(4);
      })
    );

    it.effect("counts CRM entries as contacts plus companies", () =>
      Effect.gen(function* () {
        const planCompliance = yield* PlanCompliance;
        const { organizationId } = yield* makeOrganization();

        for (let index = 0; index < 6; index++) {
          yield* addContact(organizationId, `Contact ${index}`);
        }
        for (let index = 0; index < 5; index++) {
          yield* addCompany(organizationId, `Company ${index}`);
        }

        const snapshot = yield* planCompliance.snapshot({
          includeResources: true,
          organizationId,
        });
        const crmEntries = byKind(snapshot, "crmEntries");

        expect(crmEntries?.count).toBe(11);
        expect(crmEntries?.limit).toBe(10);
        expect(crmEntries?.resources).toHaveLength(11);
        expect(
          crmEntries?.resources.filter(
            (resource) => resource.kind === "company"
          )
        ).toHaveLength(5);
      })
    );

    it.effect("reports no violations on a plan with unlimited allowances", () =>
      Effect.gen(function* () {
        const planCompliance = yield* PlanCompliance;
        const { organizationId } = yield* makeOrganization();
        yield* addPlan(organizationId, "professional");

        for (let index = 0; index < 10; index++) {
          yield* addBoard(organizationId, `Board ${index}`, "PUBLIC");
        }
        for (let index = 0; index < 12; index++) {
          yield* addContact(organizationId, `Contact ${index}`);
        }

        const snapshot = yield* planCompliance.snapshot({
          includeResources: true,
          organizationId,
        });

        expect(snapshot.plan).toBe("professional");
        expect(snapshot.violations).toEqual([]);
        expect(snapshot.degraded).toEqual([]);
      })
    );
  });
});
