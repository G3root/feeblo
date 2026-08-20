import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  ContactAttributeDefinitionId,
  ContactId,
  WorkspaceId,
} from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AttributeDefinitionRepository } from "../attribute-definition/repository";
import { CompanyRepository } from "../company/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import { CurrentSession, type Session } from "../session-middleware";
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
      const now = new Date();
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
    AttributeDefinitionRepository.layer
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
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const contacts = yield* handlers
          .ContactList({ organizationId: fixture.organizationId })
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
          .ContactCreate({
            organizationId: fixture.organizationId,
            name: "Ada",
            email: "ada@example.com",
          })
          .pipe(Effect.provideService(CurrentSession, session));
        const contactId = yield* ContactId.parse(created.id);

        const updated = yield* handlers
          .ContactUpdate({
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
          .ContactDelete({
            id: contactId,
            organizationId: fixture.organizationId,
          })
          .pipe(Effect.provideService(CurrentSession, session));

        const contacts = yield* handlers
          .ContactList({ organizationId: fixture.organizationId })
          .pipe(Effect.provideService(CurrentSession, session));
        expect(contacts).toHaveLength(0);
      })
    );

    it.effect("rejects contributors (contacts.create is manager+)", () =>
      Effect.gen(function* () {
        const handlers = yield* ContactRpcHandlersEffect;
        const fixture = yield* makeFixture();

        const error = yield* Effect.flip(
          handlers
            .ContactCreate({
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
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const error = yield* Effect.flip(
          handlers
            .ContactCreate({
              organizationId: fixture.organizationId,
              name: "Ada",
              email: "ada@example.com",
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)))
        );
        expect(error._tag).toBe("BadRequestError");

        const contacts = yield* handlers
          .ContactList({ organizationId: fixture.organizationId })
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
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const error = yield* Effect.flip(
          handlers
            .ContactCreate({
              organizationId: fixture.organizationId,
              name: "Ada",
              email: "ada@example.com",
              attributeValues: [{ attributeId, value: 17 }],
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)))
        );
        expect(error._tag).toBe("BadRequestError");

        const contacts = yield* handlers
          .ContactList({ organizationId: fixture.organizationId })
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
          const now = new Date();

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
              .ContactCreate({
                organizationId: fixture.organizationId,
                name: "Ada",
                email: "ada@example.com",
                attributeValues: [{ attributeId, value: "secret" }],
              })
              .pipe(Effect.provideService(CurrentSession, makeSession(fixture)))
          );
          expect(error._tag).toBe("PolicyDenied");

          const contacts = yield* handlers
            .ContactList({ organizationId: fixture.organizationId })
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
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const error = yield* Effect.flip(
          handlers
            .ContactDelete({
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
          const now = new Date();

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
              .ContactCreate({
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
          .ContactCreate({
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
