import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  CompanyAttributeDefinitionId,
  CompanyId,
  WorkspaceId,
} from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { CurrentSession, type Session } from "../session-middleware";
import { AttributeDefinitionRepository } from "../attribute-definition/repository";
import { CompanyRpcHandlersEffect } from "./handlers";
import { CompanyPolicy } from "./policies";
import { CompanyRepository } from "./repository";

describe("CompanyRpcHandlers", () => {
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
    CompanyRepository.layer.pipe(Layer.provide(Database.PgliteDatabaseLive)),
    AttributeDefinitionRepository.layer.pipe(
      Layer.provide(Database.PgliteDatabaseLive)
    ),
    Database.PgliteDatabaseLive
  );
  const TestLayer = CompanyPolicy.layer.pipe(Layer.provideMerge(Repositories));

  layer(TestLayer)("handlers", (it) => {
    it.effect("lists companies for organization members", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const handlers = yield* CompanyRpcHandlersEffect;
        const fixture = yield* makeFixture();
        yield* db.insert(schema.companyTable).values({
          id: `company_${fixture.organizationId}`,
          organizationId: fixture.organizationId,
          name: "Acme",
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const companies = yield* handlers
          .CompanyList({ organizationId: fixture.organizationId })
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
        expect(companies).toHaveLength(1);
        expect(companies[0]).toMatchObject({ name: "Acme" });
      })
    );

    it.effect("rejects non-members from listing companies", () =>
      Effect.gen(function* () {
        const handlers = yield* CompanyRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const error = yield* Effect.flip(
          handlers
            .CompanyList({ organizationId: fixture.organizationId })
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture, false))
            )
        );
        expect(error._tag).toBe("PolicyDenied");
      })
    );

    it.effect("creates, updates, and deletes a company", () =>
      Effect.gen(function* () {
        const handlers = yield* CompanyRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const session = makeSession(fixture);

        const created = yield* handlers
          .CompanyCreate({
            organizationId: fixture.organizationId,
            name: "Acme",
          })
          .pipe(Effect.provideService(CurrentSession, session));
        const companyId = yield* CompanyId.parse(created.id);

        const updated = yield* handlers
          .CompanyUpdate({
            id: companyId,
            organizationId: fixture.organizationId,
            name: "Acme Inc.",
          })
          .pipe(Effect.provideService(CurrentSession, session));
        expect(updated).toMatchObject({
          id: created.id,
          name: "Acme Inc.",
        });

        yield* handlers
          .CompanyDelete({
            id: companyId,
            organizationId: fixture.organizationId,
          })
          .pipe(Effect.provideService(CurrentSession, session));

        const companies = yield* handlers
          .CompanyList({ organizationId: fixture.organizationId })
          .pipe(Effect.provideService(CurrentSession, session));
        expect(companies).toHaveLength(0);
      })
    );

    it.effect("rejects attributes from another organization when creating a company", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const handlers = yield* CompanyRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const foreignOrganizationId = yield* WorkspaceId.generate;
        const attributeId = yield* CompanyAttributeDefinitionId.generate;
        const now = new Date();

        yield* db.insert(schema.organizationTable).values({
          id: foreignOrganizationId,
          name: "Foreign organization",
          slug: foreignOrganizationId,
          createdAt: now,
        });
        yield* db.insert(schema.companyAttributeDefinitionTable).values({
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
            .CompanyCreate({
              organizationId: fixture.organizationId,
              name: "Acme",
              attributeValues: [{ attributeId, value: "secret" }],
            })
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture))
            )
        );
        expect(error._tag).toBe("PolicyDenied");

        const companies = yield* handlers
          .CompanyList({ organizationId: fixture.organizationId })
          .pipe(
            Effect.provideService(CurrentSession, makeSession(fixture))
          );
        expect(companies).toHaveLength(0);
      })
    );
  });
});
