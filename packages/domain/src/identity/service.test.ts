import { createHash } from "node:crypto";

import { NodeCrypto } from "@effect/platform-node";
import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { ContactId, WorkspaceId } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { InvalidSubjectError, SubjectNotFoundError } from "./errors";
import { ResolvePrincipalService } from "./service";

const hashEmail = (email: string): string =>
  createHash("sha256").update(email.toLowerCase().trim()).digest("hex");

describe("ResolvePrincipalService", () => {
  const TestLayer = Layer.mergeAll(
    ResolvePrincipalService.layer.pipe(
      Layer.provide(Database.PgliteDatabaseLive)
    ),
    Database.PgliteDatabaseLive,
    NodeCrypto.layer
  );

  const makeOrganization = () =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "Test organization",
        slug: organizationId,
        createdAt: new Date(),
      });
      return organizationId;
    });

  const insertGlobalUser = (args: {
    id: string;
    email: string;
    name?: string;
    restrictedToOrganizationId?: string | null;
    emailVerified?: boolean;
  }) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const values: typeof schema.userTable.$inferInsert = {
        id: args.id,
        name: args.name ?? args.id,
        email: args.email,
        emailHash: hashEmail(args.email),
        emailVerified: args.emailVerified ?? true,
      };
      if (args.restrictedToOrganizationId !== undefined) {
        values.restrictedToOrganizationId = args.restrictedToOrganizationId;
      }
      yield* db.insert(schema.userTable).values(values);
    });

  const getUserById = (id: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const rows = yield* db
        .select()
        .from(schema.userTable)
        .where(eq(schema.userTable.id, id))
        .limit(1);
      return rows[0];
    });

  const getContactById = (id: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const rows = yield* db
        .select()
        .from(schema.contactTable)
        .where(eq(schema.contactTable.id, id))
        .limit(1);
      return rows[0];
    });

  layer(TestLayer)("resolve", (it) => {
    it.effect(
      "creates a bare contact when nothing matches and no user is needed",
      () =>
        Effect.gen(function* () {
          const service = yield* ResolvePrincipalService;
          const organizationId = yield* makeOrganization();

          const resolved = yield* service.resolve({
            organizationId,
            needsUser: false,
            subject: { email: "jane@example.com", name: "Jane Doe" },
          });

          const contact = yield* getContactById(resolved.contactId);
          expect(contact?.email).toBe("jane@example.com");
          expect(contact?.name).toBe("Jane Doe");
          expect(contact?.userId).toBeNull();
          expect(resolved.userId).toBeNull();
        })
    );

    it.effect("provisions a shadow user when a user row is required", () =>
      Effect.gen(function* () {
        const service = yield* ResolvePrincipalService;
        const organizationId = yield* makeOrganization();

        const resolved = yield* service.resolve({
          organizationId,
          needsUser: true,
          subject: { email: "jane@example.com", name: "Jane Doe" },
        });

        expect(resolved.userId).not.toBeNull();
        const shadow = yield* getUserById(resolved.userId!);
        expect(shadow?.email).toMatch(/^behalf-[0-9a-f]{16}@feeblo\.com$/);
        expect(shadow?.emailVerified).toBe(false);
        expect(shadow?.restrictedToOrganizationId).toBe(organizationId);

        const contact = yield* getContactById(resolved.contactId);
        expect(contact?.userId).toBe(resolved.userId);
      })
    );

    it.effect(
      "reuses an existing org contact and enriches only empty fields",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const service = yield* ResolvePrincipalService;
          const organizationId = yield* makeOrganization();
          const contactId = yield* ContactId.generate;

          yield* db.insert(schema.contactTable).values({
            id: contactId,
            organizationId,
            name: "Existing Name",
            email: "jane@example.com",
          });

          const resolved = yield* service.resolve({
            organizationId,
            needsUser: false,
            subject: {
              email: "jane@example.com",
              name: "Overwritten?",
              avatarUrl: "https://example.com/a.png",
            },
          });

          expect(resolved.contactId).toBe(contactId);
          const contact = yield* getContactById(contactId);
          expect(contact?.name).toBe("Existing Name");
          expect(contact?.avatar).toBe("https://example.com/a.png");
        })
    );

    it.effect(
      "adopts an unrestricted global account instead of shadowing it",
      () =>
        Effect.gen(function* () {
          const service = yield* ResolvePrincipalService;
          const organizationId = yield* makeOrganization();
          yield* insertGlobalUser({
            id: "user_global",
            email: "jane@example.com",
          });

          const resolved = yield* service.resolve({
            organizationId,
            needsUser: true,
            subject: { email: "jane@example.com", name: "Jane" },
          });

          expect(resolved.userId).toBe("user_global");
          const contact = yield* getContactById(resolved.contactId);
          expect(contact?.userId).toBe("user_global");
        })
    );

    it.effect(
      "does not adopt an account restricted to another organization",
      () =>
        Effect.gen(function* () {
          const service = yield* ResolvePrincipalService;
          const organizationId = yield* makeOrganization();
          yield* insertGlobalUser({
            id: "user_foreign_portal",
            email: "portal@example.com",
            restrictedToOrganizationId: "org-somewhere-else",
          });

          const resolved = yield* service.resolve({
            organizationId,
            needsUser: true,
            subject: { email: "portal@example.com" },
          });

          // A fresh shadow scoped to this workspace, not the foreign portal user.
          expect(resolved.userId).not.toBe("user_foreign_portal");
          const shadow = yield* getUserById(resolved.userId!);
          expect(shadow?.restrictedToOrganizationId).toBe(organizationId);
        })
    );

    it.effect("resolves by explicit userId ahead of any email", () =>
      Effect.gen(function* () {
        const service = yield* ResolvePrincipalService;
        const organizationId = yield* makeOrganization();
        yield* insertGlobalUser({
          id: "user_alice",
          email: "alice@example.com",
        });

        const resolved = yield* service.resolve({
          organizationId,
          needsUser: false,
          subject: {
            userId: "user_alice",
            email: "typed@example.com",
            name: "Typed Name",
          },
        });

        const contact = yield* getContactById(resolved.contactId);
        expect(contact?.userId).toBe("user_alice");
        expect(resolved.userId).toBe("user_alice");
      })
    );

    it.effect("fails when an explicit userId does not exist", () =>
      Effect.gen(function* () {
        const service = yield* ResolvePrincipalService;
        const organizationId = yield* makeOrganization();

        const error = yield* service
          .resolve({
            organizationId,
            needsUser: false,
            subject: { userId: "user_missing" },
          })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(SubjectNotFoundError);
      })
    );

    it.effect(
      "fails when an explicit contactId is from another organization",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const service = yield* ResolvePrincipalService;
          const [organizationId, otherOrganizationId] = [
            yield* makeOrganization(),
            yield* makeOrganization(),
          ];
          const contactId = yield* ContactId.generate;
          yield* db.insert(schema.contactTable).values({
            id: contactId,
            organizationId: otherOrganizationId,
            email: "cross-org@example.com",
          });

          const error = yield* service
            .resolve({
              organizationId,
              needsUser: false,
              subject: { contactId },
            })
            .pipe(Effect.flip);

          expect(error).toBeInstanceOf(SubjectNotFoundError);
        })
    );

    it.effect("is idempotent for repeated resolutions", () =>
      Effect.gen(function* () {
        const service = yield* ResolvePrincipalService;
        const organizationId = yield* makeOrganization();

        const first = yield* service.resolve({
          organizationId,
          needsUser: true,
          subject: { email: "jane@example.com", name: "Jane" },
        });
        const second = yield* service.resolve({
          organizationId,
          needsUser: true,
          subject: { email: "jane@example.com", name: "Jane" },
        });

        expect(second.contactId).toBe(first.contactId);
        expect(second.userId).toBe(first.userId);
      })
    );

    it.effect(
      "claims an email-only contact when an external id arrives later",
      () =>
        Effect.gen(function* () {
          const service = yield* ResolvePrincipalService;
          const organizationId = yield* makeOrganization();

          const first = yield* service.resolve({
            organizationId,
            needsUser: false,
            subject: { email: "jane@example.com", name: "Jane" },
          });
          const second = yield* service.resolve({
            organizationId,
            needsUser: false,
            subject: { externalId: "crm-42", email: "jane@example.com" },
          });

          expect(second.contactId).toBe(first.contactId);
          const contact = yield* getContactById(first.contactId);
          expect(contact?.externalId).toBe("crm-42");
        })
    );

    it.effect("fails when a user row is required but no email exists", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const service = yield* ResolvePrincipalService;
        const organizationId = yield* makeOrganization();
        const contactId = yield* ContactId.generate;
        yield* db.insert(schema.contactTable).values({
          id: contactId,
          organizationId,
          name: "No Email",
        });

        const error = yield* service
          .resolve({
            organizationId,
            needsUser: true,
            subject: { contactId },
          })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(InvalidSubjectError);
      })
    );

    it.effect("fails when no identifier is supplied", () =>
      Effect.gen(function* () {
        const service = yield* ResolvePrincipalService;
        const organizationId = yield* makeOrganization();

        const error = yield* service
          .resolve({ organizationId, needsUser: false, subject: {} })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(InvalidSubjectError);
      })
    );
  });
});
