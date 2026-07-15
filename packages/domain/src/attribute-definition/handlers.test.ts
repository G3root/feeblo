import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  CompanyAttributeDefinitionId,
  ContactAttributeDefinitionId,
  WorkspaceId,
} from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { CurrentSession, type Session } from "../session-middleware";
import { AttributeDefinitionRpcHandlersEffect } from "./handlers";
import { AttributeDefinitionRepository } from "./repository";

describe("AttributeDefinitionRpcHandlers", () => {
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

      const session: Session = {
        user: {
          id: userId,
          email: "user@example.com",
          name: "Test User",
          restrictedToOrganizationId: null,
        },
        session: { userId, token: "test-token" },
        organizations: [{ id: organizationId }],
        memberships: [{ membershipId, organizationId, role: "owner" }],
      };

      return { organizationId, session };
    });

  const TestLayer = Layer.merge(
    AttributeDefinitionRepository.layer.pipe(
      Layer.provide(Database.PgliteDatabaseLive)
    ),
    Database.PgliteDatabaseLive
  );

  layer(TestLayer)("handlers", (it) => {
    it.effect("creates and lists contact and company definitions", () =>
      Effect.gen(function* () {
        const handlers = yield* AttributeDefinitionRpcHandlersEffect;
        const { organizationId, session } = yield* makeFixture();
        const contactId = yield* ContactAttributeDefinitionId.generate;
        const companyId = yield* CompanyAttributeDefinitionId.generate;
        const provideSession = Effect.provideService(CurrentSession, session);

        yield* handlers
          .ContactAttributeDefinitionCreate({
            id: contactId,
            organizationId,
            name: "Job title",
            key: "jobTitle",
            description: null,
            type: "TEXT",
            isRequired: false,
          })
          .pipe(provideSession);
        yield* handlers
          .CompanyAttributeDefinitionCreate({
            id: companyId,
            organizationId,
            name: "Industry",
            key: "industry",
            description: null,
            type: "TEXT",
            isRequired: false,
          })
          .pipe(provideSession);

        const contactDefinitions = yield* handlers
          .ContactAttributeDefinitionList({ organizationId })
          .pipe(provideSession);
        const companyDefinitions = yield* handlers
          .CompanyAttributeDefinitionList({ organizationId })
          .pipe(provideSession);

        expect(contactDefinitions).toHaveLength(1);
        expect(contactDefinitions[0]).toMatchObject({ key: "jobTitle" });
        expect(companyDefinitions).toHaveLength(1);
        expect(companyDefinitions[0]).toMatchObject({ key: "industry" });
      })
    );
  });
});
