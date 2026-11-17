import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  CompanyAttributeDefinitionId,
  ContactAttributeDefinitionId,
  ContactAttributeValueId,
  ContactId,
  WorkspaceId,
} from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AuditLogEnabled } from "../audit-log/flag";
import { AuditLogRecorder } from "../audit-log/recorder";
import { CurrentSession, type Session } from "../session-middleware";
import { AttributeDefinitionRpcHandlersEffect } from "./handlers";
import { AttributeDefinitionPolicy } from "./policies";
import { AttributeDefinitionRepository } from "./repository";

describe("AttributeDefinitionRpcHandlers", () => {
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

  const RepositoryLayer = AttributeDefinitionRepository.layer.pipe(
    Layer.provide(Database.PgliteDatabaseLive)
  );

  const TestLayer = Layer.mergeAll(
    Layer.merge(
      RepositoryLayer,
      AttributeDefinitionPolicy.layer.pipe(Layer.provide(RepositoryLayer))
    ),
    AuditLogRecorder.layer.pipe(Layer.provide(Database.PgliteDatabaseLive)),
    Database.PgliteDatabaseLive
  );

  layer(TestLayer)("handlers", (it) => {
    it.effect(
      "creates, updates, lists, and deletes contact and company definitions",
      () =>
        Effect.gen(function* () {
          const handlers = yield* AttributeDefinitionRpcHandlersEffect;
          const { organizationId, session } = yield* makeFixture();
          const contactId = yield* ContactAttributeDefinitionId.generate;
          const companyId = yield* CompanyAttributeDefinitionId.generate;
          const provideSession = Effect.provideService(CurrentSession, session);

          yield* handlers
            .CreateContactAttributeDefinition({
              id: contactId,
              organizationId,
              name: "Job title",
              key: "ignoredContactKey",
              description: null,
              type: "TEXT",
              isRequired: false,
            })
            .pipe(provideSession);
          yield* handlers
            .CreateCompanyAttributeDefinition({
              id: companyId,
              organizationId,
              name: "Industry vertical",
              key: "ignoredCompanyKey",
              description: null,
              type: "TEXT",
              isRequired: false,
            })
            .pipe(provideSession);

          yield* handlers
            .UpdateContactAttributeDefinition({
              id: contactId,
              organizationId,
              name: "Account role",
              key: "anotherIgnoredContactKey",
              description: "The contact's role",
              isRequired: true,
            })
            .pipe(provideSession);
          yield* handlers
            .UpdateCompanyAttributeDefinition({
              id: companyId,
              organizationId,
              name: "Market sector",
              key: "anotherIgnoredCompanyKey",
              description: "The company's sector",
              isRequired: true,
            })
            .pipe(provideSession);

          const contactDefinitions = yield* handlers
            .ListContactAttributeDefinitions({ organizationId })
            .pipe(provideSession);

          const companyDefinitions = yield* handlers
            .ListCompanyAttributeDefinitions({ organizationId })
            .pipe(provideSession);

          expect(contactDefinitions).toHaveLength(1);
          expect(contactDefinitions[0]).toMatchObject({
            key: "accountRole",
            isRequired: true,
          });
          expect(companyDefinitions).toHaveLength(1);
          expect(companyDefinitions[0]).toMatchObject({
            key: "marketSector",
            isRequired: true,
          });

          yield* handlers
            .DeleteContactAttributeDefinition({ id: contactId, organizationId })
            .pipe(provideSession);
          yield* handlers
            .DeleteCompanyAttributeDefinition({ id: companyId, organizationId })
            .pipe(provideSession);

          expect(
            yield* handlers
              .ListContactAttributeDefinitions({ organizationId })
              .pipe(provideSession)
          ).toHaveLength(0);
          expect(
            yield* handlers
              .ListCompanyAttributeDefinitions({ organizationId })
              .pipe(provideSession)
          ).toHaveLength(0);
        })
    );
    it.effect("rejects a non-admin member from managing definitions", () =>
      Effect.gen(function* () {
        const handlers = yield* AttributeDefinitionRpcHandlersEffect;
        const { organizationId, session } = yield* makeFixture();

        const memberSession: Session = {
          ...session,
          memberships: session.memberships.map((membership) => ({
            ...membership,
            role: "manager",
          })),
        };

        const provideMemberSession = Effect.provideService(
          CurrentSession,
          memberSession
        );

        const contactId = yield* ContactAttributeDefinitionId.generate;

        const createError = yield* Effect.flip(
          handlers
            .CreateContactAttributeDefinition({
              id: contactId,
              organizationId,
              name: "Job title",
              key: "ignoredContactKey",
              description: null,
              type: "TEXT",
              isRequired: false,
            })
            .pipe(provideMemberSession)
        );

        expect(createError._tag).toBe("PolicyDenied");

        const deleteError = yield* Effect.flip(
          handlers
            .DeleteContactAttributeDefinition({
              id: contactId,
              organizationId,
            })
            .pipe(provideMemberSession)
        );

        expect(deleteError._tag).toBe("PolicyDenied");
      })
    );

    it.effect(
      "refuses an attribute value update whose id names another attribute's row",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const handlers = yield* AttributeDefinitionRpcHandlersEffect;
          const { organizationId, session } = yield* makeFixture();
          const provideSession = Effect.provideService(CurrentSession, session);

          const contactRowId = yield* ContactId.generate;
          const now = yield* DateTime.nowAsDate;
          yield* db.insert(schema.contactTable).values({
            id: contactRowId,
            organizationId,
            name: "Ada",
            email: "ada@example.com",
            createdAt: now,
            updatedAt: now,
          });

          const textId = yield* ContactAttributeDefinitionId.generate;
          const numberId = yield* ContactAttributeDefinitionId.generate;

          for (const [definitionId, name, key] of [
            [textId, "Job title", "jobTitle"],
            [numberId, "Report count", "reportCount"],
          ] as const) {
            yield* handlers
              .CreateContactAttributeDefinition({
                id: definitionId,
                organizationId,
                name,
                key,
                description: null,
                type: "TEXT",
                isRequired: false,
              })
              .pipe(provideSession);
          }

          // A value row under the TEXT attribute.
          const valueRowId = yield* ContactAttributeValueId.generate;
          yield* db.insert(schema.contactAttributeValueTable).values({
            id: valueRowId,
            organizationId,
            contactId: contactRowId,
            attributeId: textId,
            valueText: "Engineer",
            createdAt: now,
            updatedAt: now,
          });

          // Naming the INTEGER attribute with the TEXT row's id: the value is
          // validated against the named definition, so the write must not
          // land on another attribute's row - it is refused outright.
          const error = yield* Effect.flip(
            handlers
              .UpdateContactAttributeValue({
                id: valueRowId,
                organizationId,
                contactId: contactRowId,
                attributeId: numberId,
                value: "Manager",
              })
              .pipe(provideSession)
          );

          expect(error._tag).toBe("BadRequestError");

          const rows = yield* db
            .select()
            .from(schema.contactAttributeValueTable)
            .where(eq(schema.contactAttributeValueTable.id, valueRowId));

          expect(rows).toHaveLength(1);
          expect(rows[0]?.attributeId).toBe(textId);
          expect(rows[0]?.valueText).toBe("Engineer");
        })
    );

    it.effect(
      "refuses an upsert whose id is already another row's, and inserts an unused one",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const repository = yield* AttributeDefinitionRepository;
          const handlers = yield* AttributeDefinitionRpcHandlersEffect;
          const { organizationId, session } = yield* makeFixture();
          const provideSession = Effect.provideService(CurrentSession, session);

          const firstContactId = yield* ContactId.generate;
          const secondContactId = yield* ContactId.generate;
          const now = yield* DateTime.nowAsDate;
          yield* db.insert(schema.contactTable).values([
            {
              id: firstContactId,
              organizationId,
              name: "Ada",
              createdAt: now,
              updatedAt: now,
            },
            {
              id: secondContactId,
              organizationId,
              name: "Grace",
              createdAt: now,
              updatedAt: now,
            },
          ]);

          const textId = yield* ContactAttributeDefinitionId.generate;
          const numberId = yield* ContactAttributeDefinitionId.generate;

          for (const [definitionId, name, key] of [
            [textId, "Job title", "jobTitle"],
            [numberId, "Report count", "reportCount"],
          ] as const) {
            yield* handlers
              .CreateContactAttributeDefinition({
                id: definitionId,
                organizationId,
                name,
                key,
                description: null,
                type: "TEXT",
                isRequired: false,
              })
              .pipe(provideSession);
          }

          // The first contact owns a value row under the TEXT attribute.
          const valueRowId = yield* ContactAttributeValueId.generate;
          yield* db.insert(schema.contactAttributeValueTable).values({
            id: valueRowId,
            organizationId,
            contactId: firstContactId,
            attributeId: textId,
            valueText: "Engineer",
            createdAt: now,
            updatedAt: now,
          });

          // The upsert names the second contact's attribute with the first
          // contact's row id. The row is not this (owner, attribute) pair's,
          // so the fallback insert must be refused before it reaches the
          // primary key the pair conflict target does not cover.
          const error = yield* Effect.flip(
            repository.upsertContactAttributeValue({
              id: valueRowId,
              organizationId,
              contactId: secondContactId,
              attributeId: numberId,
              value: 3,
            })
          );

          expect(error._tag).toBe("FailedToUpsertAttributeValueError");
          expect(
            yield* db
              .select()
              .from(schema.contactAttributeValueTable)
              .where(
                eq(schema.contactAttributeValueTable.contactId, secondContactId)
              )
          ).toHaveLength(0);
          expect(
            yield* db
              .select()
              .from(schema.contactAttributeValueTable)
              .where(eq(schema.contactAttributeValueTable.id, valueRowId))
          ).toHaveLength(1);

          // An unused client id still inserts.
          const unusedId = yield* ContactAttributeValueId.generate;

          const inserted = yield* repository.upsertContactAttributeValue({
            id: unusedId,
            organizationId,
            contactId: secondContactId,
            attributeId: numberId,
            value: 3,
          });

          expect(inserted?.id).toBe(unusedId);
        })
    );
    it.effect("records a definition create and a value update", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const handlers = yield* AttributeDefinitionRpcHandlersEffect;
        const { organizationId, session } = yield* makeFixture();
        const provideSession = Effect.provideService(CurrentSession, session);
        const auditOn = Effect.provideService(AuditLogEnabled, true);
        const definitionId = yield* ContactAttributeDefinitionId.generate;

        yield* handlers
          .CreateContactAttributeDefinition({
            id: definitionId,
            organizationId,
            name: "Job title",
            key: "jobTitle",
            description: null,
            type: "TEXT",
            isRequired: false,
          })
          .pipe(provideSession, auditOn);

        const contactId = yield* ContactId.generate;
        const valueId = yield* ContactAttributeValueId.generate;
        const now = yield* DateTime.nowAsDate;
        yield* db.insert(schema.contactTable).values({
          id: contactId,
          organizationId,
          name: "Ada",
          email: "ada@example.com",
          createdAt: now,
          updatedAt: now,
        });
        yield* db.insert(schema.contactAttributeValueTable).values({
          id: valueId,
          organizationId,
          contactId,
          attributeId: definitionId,
          valueText: "Engineer",
          createdAt: now,
          updatedAt: now,
        });

        yield* handlers
          .UpdateContactAttributeValue({
            id: valueId,
            organizationId,
            contactId,
            attributeId: definitionId,
            value: "Manager",
          })
          .pipe(provideSession, auditOn);

        const rows = yield* db
          .select()
          .from(schema.auditLogTable)
          .where(eq(schema.auditLogTable.organizationId, organizationId));

        expect(rows.map((row) => row.action).sort()).toEqual([
          "attribute_definition.created",
          "attribute_definition.value_updated",
        ]);
        expect(
          rows.find(
            (row) => row.action === "attribute_definition.value_updated"
          )
        ).toMatchObject({
          actorType: "user",
          actorUserId: session.user.id,
          outcome: "allowed",
          resourceId: definitionId,
          resourceType: "attribute_definition",
          source: "dashboard",
          metadata: { target: "contact", contactId, valueId },
        });
      })
    );
  });
});
