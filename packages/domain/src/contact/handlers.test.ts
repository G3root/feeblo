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
import { CurrentSession, type Session } from "../session-middleware";
import { ContactRpcHandlersEffect } from "./handlers";
import { ContactPolicy } from "./policies";
import { ContactRepository } from "./repository";

describe("ContactRpcHandlers", () => {
  type Fixture = {
    membershipId: string;
    organizationId: string;
    userId: string;
  };

  const makeSession = (fixture: Fixture, isMember = true): Session => ({
    user: {
      id: fixture.userId,
      email: "user@example.com",
      name: "Test User",
      restrictedToOrganizationId: null,
    },
    session: { userId: fixture.userId, token: "test-token" },
    organizations: [{ id: fixture.organizationId }],
    memberships: isMember
      ? [
          {
            membershipId: fixture.membershipId,
            organizationId: fixture.organizationId,
            role: "owner",
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
    ContactRepository.layer.pipe(Layer.provide(Database.PgliteDatabaseLive)),
    AttributeDefinitionRepository.layer.pipe(
      Layer.provide(Database.PgliteDatabaseLive)
    ),
    Database.PgliteDatabaseLive
  );
  const TestLayer = ContactPolicy.layer.pipe(Layer.provideMerge(Repositories));

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

    it.effect("rejects attributes from another organization when creating a contact", () =>
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
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture))
            )
        );
        expect(error._tag).toBe("PolicyDenied");

        const contacts = yield* handlers
          .ContactList({ organizationId: fixture.organizationId })
          .pipe(
            Effect.provideService(CurrentSession, makeSession(fixture))
          );
        expect(contacts).toHaveLength(0);
      })
    );
  });
});
