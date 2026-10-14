import { createHash } from "node:crypto";

import { NodeCrypto } from "@effect/platform-node";
import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { ContactId, WorkspaceId } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
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
        createdAt: yield* DateTime.nowAsDate,
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
        role: "contributor",
        createdAt: yield* DateTime.nowAsDate,
      });
    });

  const getContactCount = (organizationId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const rows = yield* db
        .select({ id: schema.contactTable.id })
        .from(schema.contactTable)
        .where(eq(schema.contactTable.organizationId, organizationId));
      return rows.length;
    });

  const getContactById = (id: string | null) =>
    Effect.gen(function* () {
      if (id === null) {
        return undefined;
      }
      const db = yield* currentDb;
      const rows = yield* db
        .select()
        .from(schema.contactTable)
        .where(eq(schema.contactTable.id, id))
        .limit(1);
      return rows[0];
    });

  layer(TestLayer)("CRM entry allowance", (it) => {
    // `free` is the only capped plan and allows 10 CRM entries, and a workspace
    // with no subscription row resolves to it. A workspace at the cap must not
    // be able to grow its contact table through on-behalf attribution.
    const FREE_PLAN_CRM_LIMIT = 10;

    const fillCrm = (organizationId: string, count: number) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const now = yield* DateTime.nowAsDate;
        yield* db.insert(schema.contactTable).values(
          Array.from({ length: count }, (_, index) => ({
            id: `contact_filler_${organizationId}_${index}`,
            organizationId,
            email: `filler-${index}@example.com`,
            createdAt: now,
            updatedAt: now,
          }))
        );
      });

    it.effect("refuses to create a contact once the plan is at its cap", () =>
      Effect.gen(function* () {
        const service = yield* ResolvePrincipalService;
        const organizationId = yield* makeOrganization();
        yield* fillCrm(organizationId, FREE_PLAN_CRM_LIMIT);

        const error = yield* Effect.flip(
          service.resolve({
            organizationId,
            needsUser: false,
            subject: { email: "one-too-many@example.com" },
          })
        );

        expect(error._tag).toBe("CrmEntryLimitReachedError");
      })
    );

    // The check sits on the insert, not on the resolution: a write attributed to
    // a customer who already has a contact consumes no room, so a full CRM must
    // not refuse it.
    it.effect(
      "still resolves an existing contact when the plan is at its cap",
      () =>
        Effect.gen(function* () {
          const service = yield* ResolvePrincipalService;
          const organizationId = yield* makeOrganization();

          const first = yield* service.resolve({
            organizationId,
            needsUser: false,
            subject: { email: "existing@example.com" },
          });
          yield* fillCrm(organizationId, FREE_PLAN_CRM_LIMIT - 1);

          const resolved = yield* service.resolve({
            organizationId,
            needsUser: false,
            subject: { email: "existing@example.com" },
          });

          expect(resolved.contactId).toBe(first.contactId);
        })
    );

    it.effect("allows one more contact while the plan has room", () =>
      Effect.gen(function* () {
        const service = yield* ResolvePrincipalService;
        const organizationId = yield* makeOrganization();
        yield* fillCrm(organizationId, FREE_PLAN_CRM_LIMIT - 1);

        const resolved = yield* service.resolve({
          organizationId,
          needsUser: false,
          subject: { email: "last-one@example.com" },
        });

        expect(resolved.contactId).not.toBe("");
      })
    );

    it.effect("resolves a staff subject at the CRM cap", () =>
      Effect.gen(function* () {
        const service = yield* ResolvePrincipalService;
        const organizationId = yield* makeOrganization();
        yield* fillCrm(organizationId, FREE_PLAN_CRM_LIMIT);
        yield* insertGlobalUser({
          id: "user_staff_capped",
          email: "staff-capped@example.com",
        });
        yield* insertMember({
          id: "member_staff_capped",
          organizationId,
          userId: "user_staff_capped",
        });

        // Attributing to staff spends no CRM room, so the cap must not refuse
        // the write the way it refuses an unseen customer.
        const resolved = yield* service.resolve({
          organizationId,
          needsUser: true,
          subject: { userId: "user_staff_capped" },
        });

        expect(resolved.memberId).toBe("member_staff_capped");
        expect(yield* getContactCount(organizationId)).toBe(
          FREE_PLAN_CRM_LIMIT
        );
      })
    );
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
          // The row was created by attribution, not the contact dialog.
          expect(contact?.source).toBe("ON_BEHALF");
          expect(resolved.userId).toBeNull();
          // A customer resolution says so explicitly: no member row.
          expect(resolved.memberId).toBeNull();
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

    it.effect(
      "attributes a staff subject to their account without creating a contact",
      () =>
        Effect.gen(function* () {
          const service = yield* ResolvePrincipalService;
          const organizationId = yield* makeOrganization();
          yield* insertGlobalUser({
            id: "user_staff",
            email: "staff@example.com",
            name: "Staff Member",
          });
          yield* insertMember({
            id: "member_staff",
            organizationId,
            userId: "user_staff",
          });

          const resolved = yield* service.resolve({
            organizationId,
            needsUser: true,
            subject: { userId: "user_staff" },
          });

          // Staff are not customers: the member row carries the attribution
          // and the CRM stays untouched, so a full CRM must not even be
          // consulted.
          expect(resolved).toEqual({
            contactId: null,
            memberId: "member_staff",
            userId: "user_staff",
          });
          expect(yield* getContactCount(organizationId)).toBe(0);
        })
    );

    it.effect("resolves a staff subject by email without a contact", () =>
      Effect.gen(function* () {
        const service = yield* ResolvePrincipalService;
        const organizationId = yield* makeOrganization();
        yield* insertGlobalUser({
          id: "user_staff_email",
          email: "staff-email@example.com",
          name: "Staff By Email",
        });
        yield* insertMember({
          id: "member_staff_email",
          organizationId,
          userId: "user_staff_email",
        });

        const resolved = yield* service.resolve({
          organizationId,
          needsUser: false,
          subject: { email: "staff-email@example.com", name: "Typed" },
        });

        expect(resolved.memberId).toBe("member_staff_email");
        expect(resolved.userId).toBe("user_staff_email");
        expect(yield* getContactCount(organizationId)).toBe(0);
      })
    );

    it.effect("keeps a pre-existing customer contact for a staff subject", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const service = yield* ResolvePrincipalService;
        const organizationId = yield* makeOrganization();
        yield* insertGlobalUser({
          id: "user_staff_contacted",
          email: "staff-contact@example.com",
        });
        yield* insertMember({
          id: "member_staff_contacted",
          organizationId,
          userId: "user_staff_contacted",
        });

        // The human was a customer before joining the workspace, so the
        // existing contact is their attribution anchor and must survive.
        const contactId = yield* ContactId.generate;
        yield* db.insert(schema.contactTable).values({
          id: contactId,
          organizationId,
          email: "staff-contact@example.com",
          userId: "user_staff_contacted",
        });

        const resolved = yield* service.resolve({
          organizationId,
          needsUser: false,
          subject: { userId: "user_staff_contacted" },
        });

        expect(resolved.contactId).toBe(contactId);
        expect(yield* getContactCount(organizationId)).toBe(1);
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
