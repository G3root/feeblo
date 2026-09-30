import { createHash } from "node:crypto";

import { NodeCrypto } from "@effect/platform-node";
import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { ContactId, WorkspaceId } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { PolicyDeniedError } from "../policy";
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
      "prefers organization-scoped identity when both global and org-scoped match",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const service = yield* ResolvePrincipalService;
          const organizationId = yield* makeOrganization();
          const email = "both-adopt@example.com";
          yield* insertGlobalUser({
            id: "user_both_global_resolve",
            email,
          });
          // Org-scoped portal identity for the same human: synthetic inbox,
          // same email hash, verified, bound to this workspace.
          yield* db.insert(schema.userTable).values({
            id: "user_both_org_resolve",
            name: "Portal",
            email: `sso-both-adopt-${organizationId.slice(0, 8)}@feeblo.com`,
            emailHash: hashEmail(email),
            emailVerified: true,
            restrictedToOrganizationId: organizationId,
          });

          const resolved = yield* service.resolve({
            organizationId,
            needsUser: true,
            subject: { email, name: "Both" },
          });

          // Attribution must match `findAdoptableByIdentityHash` precedence
          // (org-scoped wins) so it stays consistent with the SSO session
          // identity and the `sso` notification-access class.
          expect(resolved.userId).toBe("user_both_org_resolve");
          const contact = yield* getContactById(resolved.contactId);
          expect(contact?.userId).toBe("user_both_org_resolve");
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
        const db = yield* currentDb;
        const organizationId = yield* makeOrganization();
        yield* insertGlobalUser({
          id: "user_alice",
          email: "alice@example.com",
        });
        // Attribution by id requires a workspace relationship; a member row
        // is one (the picker submits member rows by userId — see
        // docs/on-behalf.md).
        yield* db.insert(schema.memberTable).values({
          id: `member_alice`,
          organizationId,
          userId: "user_alice",
          role: "contributor",
          createdAt: new Date(),
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

    it.effect(
      "resolves an SSO-bound account by explicit userId without a member row",
      () =>
        Effect.gen(function* () {
          const service = yield* ResolvePrincipalService;
          const organizationId = yield* makeOrganization();
          yield* insertGlobalUser({
            id: "user_portal",
            email: "portal-identity@example.com",
            restrictedToOrganizationId: organizationId,
          });

          const resolved = yield* service.resolve({
            organizationId,
            needsUser: false,
            subject: { userId: "user_portal" },
          });

          const contact = yield* getContactById(resolved.contactId);
          expect(contact?.userId).toBe("user_portal");
        })
    );

    it.effect(
      "resolves a global account by explicit userId when a contact already links it",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const service = yield* ResolvePrincipalService;
          const organizationId = yield* makeOrganization();
          yield* insertGlobalUser({
            id: "user_adopted",
            email: "adopted@example.com",
          });
          const contactId = yield* ContactId.generate;
          yield* db.insert(schema.contactTable).values({
            id: contactId,
            organizationId,
            email: "adopted@example.com",
            userId: "user_adopted",
          });

          const resolved = yield* service.resolve({
            organizationId,
            needsUser: false,
            subject: { userId: "user_adopted" },
          });

          expect(resolved.contactId).toBe(contactId);
        })
    );

    it.effect(
      "rejects an explicit userId of a global account with no workspace relationship",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const service = yield* ResolvePrincipalService;
          const organizationId = yield* makeOrganization();
          yield* insertGlobalUser({
            id: "user_stranger",
            email: "stranger@example.com",
          });

          const error = yield* service
            .resolve({
              organizationId,
              needsUser: false,
              subject: { userId: "user_stranger" },
            })
            .pipe(Effect.flip);

          expect(error).toBeInstanceOf(SubjectNotFoundError);
          // The account must be untouched: no contact was created for it.
          const linked = yield* db
            .select()
            .from(schema.contactTable)
            .where(eq(schema.contactTable.userId, "user_stranger"));
          expect(linked).toEqual([]);
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

    it.effect(
      "gates contact creation on the plan's CRM entry cap, but never reuse",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const service = yield* ResolvePrincipalService;
          const organizationId = yield* makeOrganization();

          // The free plan allows 10 CRM entries (contacts + companies).
          const cap = 10;
          yield* Effect.forEach(
            Array.from({ length: cap }, (_, index) => index),
            (index) =>
              Effect.gen(function* () {
                const contactId = yield* ContactId.generate;
                yield* db.insert(schema.contactTable).values({
                  id: contactId,
                  organizationId,
                  email: `filled-${index}@example.com`,
                });
              })
          );

          // Resolving to an existing contact is never capped.
          const reused = yield* service.resolve({
            organizationId,
            needsUser: false,
            subject: { email: "filled-0@example.com" },
          });
          expect(reused.contactId).toBeDefined();

          // A resolution that would create a new contact is denied.
          const error = yield* service
            .resolve({
              organizationId,
              needsUser: false,
              subject: { email: "new-customer@example.com" },
            })
            .pipe(Effect.flip);
          expect(error).toBeInstanceOf(PolicyDeniedError);

          // The denied resolution must not have written anything.
          const created = yield* db
            .select()
            .from(schema.contactTable)
            .where(eq(schema.contactTable.email, "new-customer@example.com"));
          expect(created).toEqual([]);
        })
    );
  });
});
