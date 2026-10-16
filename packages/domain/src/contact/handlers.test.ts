import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  ContactAttributeDefinitionId,
  ContactId,
  WorkspaceId,
} from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AttributeDefinitionRepository } from "../attribute-definition/repository";
import { CompanyRepository } from "../company/repository";
import { EmailSubscriptionRepository } from "../email-subscription/repository";
import { EmailSubscriptionTokenService } from "../email-subscription/tokens";
import { EntitlementPolicy } from "../entitlement/policies";
import { PolicyDeniedError } from "../policy";
import { CurrentSession, type Session } from "../session-middleware";
import { UserRepository } from "../user/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { ContactRpcHandlersEffect } from "./handlers";
import { ContactPolicy } from "./policies";
import { ContactRepository } from "./repository";

describe("ContactRpcHandlers", () => {
  type Fixture = {
    membershipId: string;
    organizationId: string;
    userId: string;
  };

  const makeSession = (
    fixture: Fixture,
    role: Session["memberships"][number]["role"] | false = "owner"
  ): Session => ({
    user: {
      id: fixture.userId,
      email: "user@example.com",
      name: "Test User",
      restrictedToOrganizationId: null,
    },
    session: { userId: fixture.userId, token: "test-token" },
    organizations: [{ id: fixture.organizationId }],
    memberships: role
      ? [
          {
            membershipId: fixture.membershipId,
            organizationId: fixture.organizationId,
            role,
          },
        ]
      : [],
  });

  const makeFixture = () =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const userId = `user_${organizationId}`;
      const membershipId = `membership_${organizationId}`;
      const now = yield* DateTime.nowAsDate;
      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "Test organization",
        slug: organizationId,
        createdAt: now,
      });
      yield* db.insert(schema.userTable).values({
        id: userId,
        email: `${organizationId}@example.com`,
        name: "Test User",
      });
      yield* db.insert(schema.memberTable).values({
        id: membershipId,
        organizationId,
        userId,
        role: "owner",
        createdAt: now,
      });
      return { membershipId, organizationId, userId } satisfies Fixture;
    });

  const Repositories = Layer.mergeAll(
    ContactRepository.layer,
    CompanyRepository.layer,
    WorkspaceRepository.layer,
    AttributeDefinitionRepository.layer,
    UserRepository.layer,
    EmailSubscriptionRepository.layerWithoutDependencies.pipe(
      Layer.provide(
        EmailSubscriptionTokenService.layerTest(
          "contact-handlers-test-signing-secret"
        )
      )
    )
  ).pipe(Layer.provide(Database.PgliteDatabaseLive));
  const Entitlements = EntitlementPolicy.layer.pipe(
    Layer.provide(WorkspaceRepository.layer),
    Layer.provide(Database.PgliteDatabaseLive)
  );
  const TestLayer = Layer.mergeAll(
    ContactPolicy.layer.pipe(
      Layer.provide(EntitlementPolicy.layer),
      Layer.provide(WorkspaceRepository.layer),
      Layer.provide(CompanyRepository.layer),
      Layer.provide(ContactRepository.layer),
      Layer.provide(Database.PgliteDatabaseLive)
    ),
    Repositories,
    Entitlements,
    Database.PgliteDatabaseLive
  );

  layer(TestLayer)("handlers", (it) => {
    it.effect("lists contacts for organization members", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const handlers = yield* ContactRpcHandlersEffect;
        const fixture = yield* makeFixture();
        yield* db.insert(schema.contactTable).values({
          id: `contact_${fixture.organizationId}`,
          organizationId: fixture.organizationId,
          name: "Ada",
          email: "ada@example.com",
          createdAt: yield* DateTime.nowAsDate,
          updatedAt: yield* DateTime.nowAsDate,
        });

        const contacts = yield* handlers
          .ListContacts({ organizationId: fixture.organizationId })
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
        expect(contacts).toHaveLength(1);
        expect(contacts[0]).toMatchObject({
          name: "Ada",
          email: "ada@example.com",
        });
      })
    );

    it.effect("creates, updates, and deletes a contact", () =>
      Effect.gen(function* () {
        const handlers = yield* ContactRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const session = makeSession(fixture);

        const created = yield* handlers
          .CreateContact({
            organizationId: fixture.organizationId,
            name: "Ada",
            email: "ada@example.com",
          })
          .pipe(Effect.provideService(CurrentSession, session));
        const contactId = yield* ContactId.parse(created.id);

        const updated = yield* handlers
          .UpdateContact({
            id: contactId,
            organizationId: fixture.organizationId,
            name: "Ada Lovelace",
            phone: "+44 20 0000 0000",
          })
          .pipe(Effect.provideService(CurrentSession, session));
        expect(updated).toMatchObject({
          id: created.id,
          name: "Ada Lovelace",
          phone: "+44 20 0000 0000",
          source: "DASHBOARD",
        });

        yield* handlers
          .DeleteContact({
            id: contactId,
            organizationId: fixture.organizationId,
          })
          .pipe(Effect.provideService(CurrentSession, session));

        const contacts = yield* handlers
          .ListContacts({ organizationId: fixture.organizationId })
          .pipe(Effect.provideService(CurrentSession, session));
        expect(contacts).toHaveLength(0);
      })
    );

    it.effect("renames the linked synthetic account but never a real one", () =>
      Effect.gen(function* () {
        const handlers = yield* ContactRpcHandlersEffect;
        const db = yield* currentDb;
        const fixture = yield* makeFixture();
        const session = makeSession(fixture);
        const now = yield* DateTime.nowAsDate;
        const shadowContactId = yield* ContactId.generate;
        const realContactId = yield* ContactId.generate;

        // A shadow account carries the customer's attributed content, so a
        // CRM rename must reach it. A real account owns its own name.
        yield* db.insert(schema.userTable).values([
          {
            id: "user_shadow_contact",
            name: "Old Name",
            email: "behalf-a1b2c3d4@feeblo.com",
            emailVerified: false,
            restrictedToOrganizationId: fixture.organizationId,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: "user_real_contact",
            name: "Account Owner",
            email: "real-contact@example.com",
            emailVerified: true,
            createdAt: now,
            updatedAt: now,
          },
        ]);
        yield* db.insert(schema.contactTable).values([
          {
            id: shadowContactId,
            organizationId: fixture.organizationId,
            email: "shadow-contact@example.com",
            name: "Old Name",
            userId: "user_shadow_contact",
            createdAt: now,
            updatedAt: now,
          },
          {
            id: realContactId,
            organizationId: fixture.organizationId,
            email: "real-contact@example.com",
            name: "Old Account Name",
            userId: "user_real_contact",
            createdAt: now,
            updatedAt: now,
          },
        ]);

        yield* handlers
          .UpdateContact({
            id: shadowContactId,
            organizationId: fixture.organizationId,
            name: "New Name",
          })
          .pipe(Effect.provideService(CurrentSession, session));
        yield* handlers
          .UpdateContact({
            id: realContactId,
            organizationId: fixture.organizationId,
            name: "CRM Label",
          })
          .pipe(Effect.provideService(CurrentSession, session));

        const users = yield* db
          .select({ id: schema.userTable.id, name: schema.userTable.name })
          .from(schema.userTable);
        expect(
          users.find((user) => user.id === "user_shadow_contact")?.name
        ).toBe("New Name");
        expect(
          users.find((user) => user.id === "user_real_contact")?.name
        ).toBe("Account Owner");
      })
    );

    it.effect(
      "deletes the linked shadow account with its contact when nothing refers to it",
      () =>
        Effect.gen(function* () {
          const handlers = yield* ContactRpcHandlersEffect;
          const db = yield* currentDb;
          const fixture = yield* makeFixture();
          const session = makeSession(fixture);
          const now = yield* DateTime.nowAsDate;
          const shadowId = `shadow_${fixture.organizationId}`;
          yield* db.insert(schema.userTable).values({
            id: shadowId,
            name: "Jane Customer",
            email: "behalf-0f0f0f0f@feeblo.com",
            emailVerified: false,
            restrictedToOrganizationId: fixture.organizationId,
            createdAt: now,
            updatedAt: now,
          });
          const contactId = yield* ContactId.generate;
          yield* db.insert(schema.contactTable).values({
            id: contactId,
            organizationId: fixture.organizationId,
            email: "shadow-customer@example.com",
            name: "Jane Customer",
            userId: shadowId,
            createdAt: now,
            updatedAt: now,
          });

          yield* handlers
            .DeleteContact({
              id: contactId,
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, session));

          const [shadow] = yield* db
            .select({ id: schema.userTable.id })
            .from(schema.userTable)
            .where(eq(schema.userTable.id, shadowId));
          expect(shadow).toBeUndefined();
        })
    );

    it.effect("keeps the shadow account while an uploaded asset remains", () =>
      Effect.gen(function* () {
        const handlers = yield* ContactRpcHandlersEffect;
        const db = yield* currentDb;
        const fixture = yield* makeFixture();
        const session = makeSession(fixture);
        const now = yield* DateTime.nowAsDate;
        const shadowId = `shadow_asset_${fixture.organizationId}`;
        yield* db.insert(schema.userTable).values({
          id: shadowId,
          name: "Asset Customer",
          email: "behalf-9182abcd@feeblo.com",
          emailVerified: false,
          restrictedToOrganizationId: fixture.organizationId,
          createdAt: now,
          updatedAt: now,
        });
        const contactId = yield* ContactId.generate;
        yield* db.insert(schema.contactTable).values({
          id: contactId,
          organizationId: fixture.organizationId,
          email: "shadow-asset@example.com",
          name: "Asset Customer",
          userId: shadowId,
          createdAt: now,
          updatedAt: now,
        });
        // An uploaded file cascades on user delete, so it must keep the
        // account alive rather than disappear with the contact.
        yield* db.insert(schema.assetTable).values({
          id: `asset_${fixture.organizationId}`,
          bucket: "uploads",
          key: `asset_${fixture.organizationId}.png`,
          url: "https://example.com/asset.png",
          kind: "editor_image",
          // `asset_owner_check` allows a user or an organization, never
          // both.
          userId: shadowId,
          createdAt: now,
          updatedAt: now,
        });

        yield* handlers
          .DeleteContact({
            id: contactId,
            organizationId: fixture.organizationId,
          })
          .pipe(Effect.provideService(CurrentSession, session));

        const [shadow] = yield* db
          .select({ id: schema.userTable.id })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, shadowId));
        expect(shadow?.id).toBe(shadowId);
      })
    );

    it.effect("keeps the shadow account while a reference remains", () =>
      Effect.gen(function* () {
        const handlers = yield* ContactRpcHandlersEffect;
        const db = yield* currentDb;
        const fixture = yield* makeFixture();
        const session = makeSession(fixture);
        const now = yield* DateTime.nowAsDate;
        const shadowId = `shadow_kept_${fixture.organizationId}`;
        yield* db.insert(schema.userTable).values({
          id: shadowId,
          name: "Ken Customer",
          email: "behalf-e5f6a7b8@feeblo.com",
          emailVerified: false,
          restrictedToOrganizationId: fixture.organizationId,
          createdAt: now,
          updatedAt: now,
        });
        const contactId = yield* ContactId.generate;
        yield* db.insert(schema.contactTable).values({
          id: contactId,
          organizationId: fixture.organizationId,
          email: "shadow-kept@example.com",
          name: "Ken Customer",
          userId: shadowId,
          createdAt: now,
          updatedAt: now,
        });
        // An email link is one of the references that keep the account
        // alive: the deferred subscription behind it activates when the
        // human signs up.
        yield* db.insert(schema.emailContactTable).values({
          id: `email_contact_kept_${fixture.organizationId}`,
          organizationId: fixture.organizationId,
          email: "shadow-kept@example.com",
          userId: shadowId,
          verificationState: "pending",
          createdAt: now,
          updatedAt: now,
        });

        yield* handlers
          .DeleteContact({
            id: contactId,
            organizationId: fixture.organizationId,
          })
          .pipe(Effect.provideService(CurrentSession, session));

        const [shadow] = yield* db
          .select({ id: schema.userTable.id })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, shadowId));
        expect(shadow?.id).toBe(shadowId);
      })
    );

    it.effect(
      "unsubscribes every subscription the contact's address holds",
      () =>
        Effect.gen(function* () {
          const handlers = yield* ContactRpcHandlersEffect;
          const db = yield* currentDb;
          const fixture = yield* makeFixture();
          const session = makeSession(fixture);
          const now = yield* DateTime.nowAsDate;
          const contactId = yield* ContactId.generate;
          yield* db.insert(schema.contactTable).values({
            id: contactId,
            organizationId: fixture.organizationId,
            email: "leaving@example.com",
            name: "Leaving Customer",
            createdAt: now,
            updatedAt: now,
          });
          const emailContactId = `email_contact_${fixture.organizationId}`;
          yield* db.insert(schema.emailContactTable).values({
            id: emailContactId,
            organizationId: fixture.organizationId,
            email: "leaving@example.com",
            verificationState: "pending",
            createdAt: now,
            updatedAt: now,
          });
          yield* db.insert(schema.emailSubscriptionTable).values({
            id: `email_sub_${fixture.organizationId}`,
            organizationId: fixture.organizationId,
            contactId: emailContactId,
            topicType: "post",
            topicId: null,
            source: "admin_added_voter",
            state: "deferred_no_access",
            createdAt: now,
            updatedAt: now,
          });

          yield* handlers
            .UnsubscribeContact({
              id: contactId,
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, session));

          const [subscription] = yield* db
            .select()
            .from(schema.emailSubscriptionTable)
            .where(
              eq(
                schema.emailSubscriptionTable.id,
                `email_sub_${fixture.organizationId}`
              )
            );
          expect(subscription?.state).toBe("unsubscribed");
          expect(subscription?.unsubscribedAt).not.toBeNull();

          // The contact itself is untouched: unsubscribing is not deleting.
          const [contact] = yield* db
            .select({ id: schema.contactTable.id })
            .from(schema.contactTable)
            .where(eq(schema.contactTable.id, contactId));
          expect(contact?.id).toBe(contactId);
        })
    );

    it.effect("reports a missing contact on unsubscribe", () =>
      Effect.gen(function* () {
        const handlers = yield* ContactRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const contactId = yield* ContactId.generate;

        const error = yield* Effect.flip(
          handlers
            .UnsubscribeContact({
              id: contactId,
              organizationId: fixture.organizationId,
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "owner")
              )
            )
        );

        // `canUpdate` includes the organization check, so a missing contact
        // is denied before the handler can name `ContactNotFoundError`; the
        // handler path is the belt beside that suspender.
        expect(error).toBeInstanceOf(PolicyDeniedError);
      })
    );

    it.effect("answers whether the plan has room for another CRM entry", () =>
      Effect.gen(function* () {
        const handlers = yield* ContactRpcHandlersEffect;
        const db = yield* currentDb;
        const fixture = yield* makeFixture();
        const session = makeSession(fixture);

        const room = yield* handlers
          .CheckContactCreateEligibility({
            organizationId: fixture.organizationId,
          })
          .pipe(Effect.provideService(CurrentSession, session));
        expect(room.canCreate).toBe(true);

        // `free` is the only capped plan and allows 10 CRM entries; the
        // picker's row must stop being offered at the cap.
        const now = yield* DateTime.nowAsDate;
        yield* db.insert(schema.contactTable).values(
          Array.from({ length: 10 }, (_, index) => ({
            id: `contact_filler_${fixture.organizationId}_${index}`,
            organizationId: fixture.organizationId,
            email: `filler-${index}@example.com`,
            createdAt: now,
            updatedAt: now,
          }))
        );

        const full = yield* handlers
          .CheckContactCreateEligibility({
            organizationId: fixture.organizationId,
          })
          .pipe(Effect.provideService(CurrentSession, session));
        expect(full.canCreate).toBe(false);
      })
    );

    it.effect("rejects contributors (contacts.create is manager+)", () =>
      Effect.gen(function* () {
        const handlers = yield* ContactRpcHandlersEffect;
        const fixture = yield* makeFixture();

        const error = yield* Effect.flip(
          handlers
            .CreateContact({
              organizationId: fixture.organizationId,
              name: "Ada",
              email: "ada@example.com",
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "contributor")
              )
            )
        );

        expect(error._tag).toBe("PolicyDenied");
      })
    );

    it.effect("rejects a contact missing a required attribute", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const handlers = yield* ContactRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const attributeId = yield* ContactAttributeDefinitionId.generate;

        yield* db.insert(schema.contactAttributeDefinitionTable).values({
          id: attributeId,
          organizationId: fixture.organizationId,
          name: "Plan",
          key: "plan",
          type: "TEXT",
          isRequired: true,
          createdAt: yield* DateTime.nowAsDate,
          updatedAt: yield* DateTime.nowAsDate,
        });

        const error = yield* Effect.flip(
          handlers
            .CreateContact({
              organizationId: fixture.organizationId,
              name: "Ada",
              email: "ada@example.com",
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)))
        );
        expect(error._tag).toBe("BadRequestError");

        const contacts = yield* handlers
          .ListContacts({ organizationId: fixture.organizationId })
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
        expect(contacts).toHaveLength(0);
      })
    );

    it.effect("rejects an invalid contact attribute value", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const handlers = yield* ContactRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const attributeId = yield* ContactAttributeDefinitionId.generate;

        yield* db.insert(schema.contactAttributeDefinitionTable).values({
          id: attributeId,
          organizationId: fixture.organizationId,
          name: "Age",
          key: "age",
          type: "INTEGER",
          config: { min: 18 },
          isRequired: false,
          createdAt: yield* DateTime.nowAsDate,
          updatedAt: yield* DateTime.nowAsDate,
        });

        const error = yield* Effect.flip(
          handlers
            .CreateContact({
              organizationId: fixture.organizationId,
              name: "Ada",
              email: "ada@example.com",
              attributeValues: [{ attributeId, value: 17 }],
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)))
        );
        expect(error._tag).toBe("BadRequestError");

        const contacts = yield* handlers
          .ListContacts({ organizationId: fixture.organizationId })
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
        expect(contacts).toHaveLength(0);
      })
    );

    it.effect(
      "rejects attributes from another organization when creating a contact",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const handlers = yield* ContactRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const foreignOrganizationId = yield* WorkspaceId.generate;
          const attributeId = yield* ContactAttributeDefinitionId.generate;
          const now = yield* DateTime.nowAsDate;

          yield* db.insert(schema.organizationTable).values({
            id: foreignOrganizationId,
            name: "Foreign organization",
            slug: foreignOrganizationId,
            createdAt: now,
          });
          yield* db.insert(schema.contactAttributeDefinitionTable).values({
            id: attributeId,
            organizationId: foreignOrganizationId,
            name: "Foreign field",
            key: "foreignField",
            type: "TEXT",
            isRequired: false,
            createdAt: now,
            updatedAt: now,
          });

          const error = yield* Effect.flip(
            handlers
              .CreateContact({
                organizationId: fixture.organizationId,
                name: "Ada",
                email: "ada@example.com",
                attributeValues: [{ attributeId, value: "secret" }],
              })
              .pipe(Effect.provideService(CurrentSession, makeSession(fixture)))
          );
          expect(error._tag).toBe("PolicyDenied");

          const contacts = yield* handlers
            .ListContacts({ organizationId: fixture.organizationId })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
          expect(contacts).toHaveLength(0);
        })
    );

    it.effect("rejects a non-admin member from deleting a contact", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const handlers = yield* ContactRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const contactId = yield* ContactId.generate;
        yield* db.insert(schema.contactTable).values({
          id: contactId,
          organizationId: fixture.organizationId,
          name: "Ada",
          email: "ada@example.com",
          createdAt: yield* DateTime.nowAsDate,
          updatedAt: yield* DateTime.nowAsDate,
        });

        const error = yield* Effect.flip(
          handlers
            .DeleteContact({
              id: contactId,
              organizationId: fixture.organizationId,
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "manager")
              )
            )
        );
        expect(error._tag).toBe("PolicyDenied");
      })
    );

    it.effect(
      "rejects linking a contact to a user outside the organization",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const handlers = yield* ContactRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const foreignOrganizationId = yield* WorkspaceId.generate;
          const foreignUserId = `user_${foreignOrganizationId}`;
          const foreignMembershipId = `membership_${foreignOrganizationId}`;
          const now = yield* DateTime.nowAsDate;

          yield* db.insert(schema.organizationTable).values({
            id: foreignOrganizationId,
            name: "Foreign organization",
            slug: foreignOrganizationId,
            createdAt: now,
          });
          yield* db.insert(schema.userTable).values({
            id: foreignUserId,
            email: `${foreignOrganizationId}@example.com`,
            name: "Foreign User",
          });
          yield* db.insert(schema.memberTable).values({
            id: foreignMembershipId,
            organizationId: foreignOrganizationId,
            userId: foreignUserId,
            role: "owner",
            createdAt: now,
          });

          const error = yield* Effect.flip(
            handlers
              .CreateContact({
                organizationId: fixture.organizationId,
                name: "Ada",
                email: "ada@example.com",
                userId: foreignUserId,
              })
              .pipe(Effect.provideService(CurrentSession, makeSession(fixture)))
          );
          expect(error._tag).toBe("PolicyDenied");
        })
    );

    it.effect("allows linking a contact to an organization member", () =>
      Effect.gen(function* () {
        const handlers = yield* ContactRpcHandlersEffect;
        const fixture = yield* makeFixture();

        const created = yield* handlers
          .CreateContact({
            organizationId: fixture.organizationId,
            name: "Ada",
            email: "ada@example.com",
            userId: fixture.userId,
          })
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

        expect(created).toMatchObject({
          name: "Ada",
          userId: fixture.userId,
        });
      })
    );
  });
});
