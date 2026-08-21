import { NodeCrypto } from "@effect/platform-node";
import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { and, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ContactRepository } from "./repository";

/**
 * Repository-level coverage for the on-behalf people-picker query. The
 * handler adds only membership policy and the short-query guard; everything
 * under test here (ranking, scoping, badges) lives in the repository.
 */
describe("ContactRepository.search", () => {
  const TestLayer = Layer.mergeAll(
    ContactRepository.layer.pipe(Layer.provide(Database.PgliteDatabaseLive)),
    Database.PgliteDatabaseLive,
    NodeCrypto.layer
  );

  const now = new Date();

  const makeOrganization = (id: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      yield* db.insert(schema.organizationTable).values({
        id,
        name: `Organization ${id}`,
        slug: id,
        createdAt: now,
      });
    });

  const insertUser = (args: {
    id: string;
    email: string;
    name?: string;
    emailVerified?: boolean;
    restrictedToOrganizationId?: string | null;
  }) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const values: typeof schema.userTable.$inferInsert = {
        id: args.id,
        name: args.name ?? args.id,
        email: args.email,
        emailVerified: args.emailVerified ?? true,
      };
      if (args.restrictedToOrganizationId !== undefined) {
        values.restrictedToOrganizationId = args.restrictedToOrganizationId;
      }
      yield* db.insert(schema.userTable).values(values);
    });

  const insertMember = (args: {
    id: string;
    organizationId: string;
    userId: string;
  }) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      yield* db.insert(schema.memberTable).values({
        id: args.id,
        organizationId: args.organizationId,
        userId: args.userId,
        role: "manager",
        createdAt: now,
      });
    });

  const insertContact = (args: {
    id: string;
    organizationId: string;
    name?: string | null;
    email?: string | null;
    userId?: string | null;
    companyId?: string | null;
  }) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const values: typeof schema.contactTable.$inferInsert = {
        id: args.id,
        organizationId: args.organizationId,
      };
      if (args.name !== undefined) {
        values.name = args.name;
      }
      if (args.email !== undefined) {
        values.email = args.email;
      }
      if (args.userId !== undefined) {
        values.userId = args.userId;
      }
      if (args.companyId !== undefined) {
        values.companyId = args.companyId;
      }
      yield* db.insert(schema.contactTable).values(values);
    });

  const insertCompany = (args: {
    id: string;
    organizationId: string;
    name: string;
  }) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      yield* db.insert(schema.companyTable).values({
        id: args.id,
        organizationId: args.organizationId,
        name: args.name,
        createdAt: now,
        updatedAt: now,
      });
    });

  let postStatusOrder = 0;
  const insertPostWithBoard = (args: {
    postId: string;
    boardVisibility: "PUBLIC" | "PRIVATE";
    organizationId: string;
  }) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const boardId = `board_${args.postId}`;
      yield* db.insert(schema.boardTable).values({
        id: boardId,
        name: "Board",
        slug: boardId,
        visibility: args.boardVisibility,
        organizationId: args.organizationId,
        createdAt: now,
        updatedAt: now,
      });
      // post_status is unique per (organization, type): reuse the org's
      // PENDING status instead of inserting a duplicate.
      const existingStatus = yield* db
        .select({ id: schema.postStatusTable.id })
        .from(schema.postStatusTable)
        .where(
          and(
            eq(schema.postStatusTable.organizationId, args.organizationId),
            eq(schema.postStatusTable.type, "PENDING")
          )
        )
        .limit(1);
      let statusId = existingStatus[0]?.id;
      if (!statusId) {
        statusId = `status_${args.postId}`;
        yield* db.insert(schema.postStatusTable).values({
          id: statusId,
          type: "PENDING",
          orderIndex: postStatusOrder++,
          organizationId: args.organizationId,
        });
      }
      yield* db.insert(schema.postTable).values({
        id: args.postId,
        title: "Post",
        slug: args.postId,
        content: "content",
        boardId,
        statusId,
        organizationId: args.organizationId,
        createdAt: now,
        updatedAt: now,
      });
    });

  const insertUpvote = (args: {
    id: string;
    postId: string;
    userId: string;
    organizationId: string;
  }) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      yield* db.insert(schema.upvoteTable).values({
        id: args.id,
        postId: args.postId,
        userId: args.userId,
        organizationId: args.organizationId,
      });
    });

  /**
   * Shared fixture graph for one organization; built once per file because
   * every test in this file shares one database.
   */
  let fixture: { organizationId: string } | null = null;
  const getFixture = () => {
    if (fixture !== null) {
      return Effect.succeed(fixture);
    }
    return Effect.gen(function* () {
      fixture = yield* buildFixture();
      return fixture;
    });
  };

  const buildFixture = () =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = "org_main";
      yield* makeOrganization(organizationId);

      // Staff member of the workspace.
      yield* insertUser({ id: "user_staff", email: "staff@acme.com" });
      yield* insertMember({
        id: "member_staff",
        organizationId,
        userId: "user_staff",
      });
      yield* insertContact({
        id: "contact_staff",
        organizationId,
        name: "Staff Member",
        email: "staff@acme.com",
        userId: "user_staff",
      });

      // SSO portal user bound to this organization.
      yield* insertUser({
        id: "user_sso",
        email: "portal@acme.com",
        restrictedToOrganizationId: organizationId,
      });
      yield* insertContact({
        id: "contact_sso",
        organizationId,
        name: "Portal User",
        email: "portal@acme.com",
        userId: "user_sso",
      });

      // Verified unrestricted global user.
      yield* insertUser({
        id: "user_global",
        email: "global@acme.com",
        name: "Global User",
      });
      yield* insertContact({
        id: "contact_global",
        organizationId,
        name: "Global Person",
        email: "global@acme.com",
        userId: "user_global",
      });

      // Shadow user: org-bound but never verified.
      yield* insertUser({
        id: "user_shadow",
        email: "behalf-abc123@feeblo.com",
        emailVerified: false,
        restrictedToOrganizationId: organizationId,
      });
      yield* insertContact({
        id: "contact_shadow",
        organizationId,
        name: "Shadowed Customer",
        email: "shadowed@acme.com",
        userId: "user_shadow",
      });

      // Bare contact with no linked account.
      yield* insertContact({
        id: "contact_bare",
        organizationId,
        name: "Bare Customer",
        email: "bare@acme.com",
      });

      return { db, organizationId };
    });

  layer(TestLayer)("search", (it) => {
    it.effect("pins an exact email match above better name matches", () =>
      Effect.gen(function* () {
        yield* getFixture();
        const repository = yield* ContactRepository;

        const results = yield* repository.search({
          organizationId: "org_main",
          query: "bare@acme.com",
        });

        expect(results.length).toBeGreaterThan(0);
        expect(results[0]?.contactId).toBe("contact_bare");
      })
    );

    it.effect("matches by company name substring", () =>
      Effect.gen(function* () {
        yield* getFixture();
        const repository = yield* ContactRepository;
        yield* insertCompany({
          id: "company_globex",
          organizationId: "org_main",
          name: "Globex Corporation",
        });
        yield* insertContact({
          id: "contact_globex",
          organizationId: "org_main",
          name: null,
          email: "someone@globex-employees.net",
          companyId: "company_globex",
        });

        const results = yield* repository.search({
          organizationId: "org_main",
          query: "Globex Corp",
        });

        expect(results.map((row) => row.contactId)).toContain(
          "contact_globex"
        );
        expect(results[0]?.companyName).toBe("Globex Corporation");
      })
    );

    it.effect("never returns contacts from another organization", () =>
      Effect.gen(function* () {
        yield* getFixture();
        const repository = yield* ContactRepository;
        yield* makeOrganization("org_other");
        yield* insertContact({
          id: "contact_foreign",
          organizationId: "org_other",
          name: "Foreign",
          email: "bare@acme.com",
        });

        const results = yield* repository.search({
          organizationId: "org_main",
          query: "bare@acme.com",
        });

        expect(results.map((row) => row.contactId)).not.toContain(
          "contact_foreign"
        );
      })
    );

    it.effect("computes member and access badges without post context", () =>
      Effect.gen(function* () {
        yield* getFixture();
        const repository = yield* ContactRepository;

        const results = yield* repository.search({
          organizationId: "org_main",
          query: "acme.com",
        });
        const byId = new Map(results.map((row) => [row.contactId, row]));

        expect(byId.get("contact_staff")?.isMember).toBe(true);
        expect(byId.get("contact_staff")?.hasAccess).toBe(true);
        expect(byId.get("contact_sso")?.isMember).toBe(false);
        expect(byId.get("contact_sso")?.hasAccess).toBe(true);
        expect(byId.get("contact_global")?.hasAccess).toBe(true);
        expect(byId.get("contact_shadow")?.hasAccess).toBe(false);
        expect(byId.get("contact_bare")?.userId).toBeNull();
        expect(byId.get("contact_bare")?.hasAccess).toBe(false);
      })
    );

    it.effect(
      "keeps members and SSO users eligible on a private-board post while global users are not",
      () =>
        Effect.gen(function* () {
          const fixture = yield* getFixture();
          const repository = yield* ContactRepository;
          yield* insertPostWithBoard({
            postId: "post_private",
            boardVisibility: "PRIVATE",
            organizationId: fixture.organizationId,
          });

          const results = yield* repository.search({
            organizationId: fixture.organizationId,
            query: "acme.com",
            postId: "post_private",
          });
          const byId = new Map(results.map((row) => [row.contactId, row]));

          expect(byId.get("contact_staff")?.hasAccess).toBe(true);
          expect(byId.get("contact_sso")?.hasAccess).toBe(true);
          expect(byId.get("contact_global")?.hasAccess).toBe(false);
        })
    );

    it.effect(
      "an unrestricted global user stays eligible on a public-board post and reports their vote",
      () =>
        Effect.gen(function* () {
          const fixture = yield* getFixture();
          const repository = yield* ContactRepository;
          yield* insertPostWithBoard({
            postId: "post_public",
            boardVisibility: "PUBLIC",
            organizationId: fixture.organizationId,
          });
          yield* insertUpvote({
            id: "upvote_global",
            postId: "post_public",
            userId: "user_global",
            organizationId: fixture.organizationId,
          });

          const results = yield* repository.search({
            organizationId: fixture.organizationId,
            query: "acme.com",
            postId: "post_public",
          });
          const byId = new Map(results.map((row) => [row.contactId, row]));

          expect(byId.get("contact_global")?.hasAccess).toBe(true);
          expect(byId.get("contact_global")?.alreadyVoted).toBe(true);
          expect(byId.get("contact_staff")?.alreadyVoted).toBe(false);
        })
    );

    it.effect("clamps limit and returns nothing for short queries", () =>
      Effect.gen(function* () {
        yield* getFixture();
        const repository = yield* ContactRepository;

        const limited = yield* repository.search({
          organizationId: "org_main",
          query: "acme.com",
          limit: 2,
        });
        expect(limited.length).toBe(2);

        const clamped = yield* repository.search({
          organizationId: "org_main",
          query: "acme.com",
          limit: 10_000,
        });
        expect(clamped.length).toBeLessThanOrEqual(25);

        const shortQuery = yield* repository.search({
          organizationId: "org_main",
          query: "a",
        });
        expect(shortQuery).toEqual([]);
      })
    );
  });
});
