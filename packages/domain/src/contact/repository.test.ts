import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { ContactId, WorkspaceId } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ContactRepository } from "./repository";

describe("ContactRepository", () => {
  const TestLayer = ContactRepository.layer.pipe(
    Layer.provideMerge(Database.PgliteDatabaseLive)
  );

  const createOrganization = (id: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      yield* db.insert(schema.organizationTable).values({
        id,
        name: "Contact upsert test workspace",
        slug: id,
        createdAt: yield* DateTime.nowAsDate,
      });
    });

  layer(TestLayer)("updateUpsertContact", (it) => {
    it.effect(
      "refuses an email another contact holds when the matched row has none",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const repository = yield* ContactRepository;
          const organizationId = yield* WorkspaceId.generate;
          const now = yield* DateTime.nowAsDate;

          yield* createOrganization(organizationId);

          // The row the external id matches carries no email yet, so the
          // email is not one the update would leave alone — it would write a
          // value another row holds.
          const ssoContactId = yield* ContactId.generate;
          yield* db.insert(schema.contactTable).values({
            id: ssoContactId,
            organizationId,
            externalId: "sso-1",
            name: "Ada",
            createdAt: now,
            updatedAt: now,
          });
          const emailHolderId = yield* ContactId.generate;
          yield* db.insert(schema.contactTable).values({
            id: emailHolderId,
            organizationId,
            email: "ada@example.com",
            name: "Ada (another record)",
            createdAt: now,
            updatedAt: now,
          });

          const existingContact = yield* repository.findUpsertContact({
            organizationId,
            externalId: "sso-1",
            email: "ada@example.com",
          });
          if (Option.isNone(existingContact)) {
            return yield* Effect.die(
              new Error("the external id must match the SSO contact")
            );
          }

          const error = yield* Effect.flip(
            repository.updateUpsertContact({
              organizationId,
              externalId: "sso-1",
              email: "ada@example.com",
              existing: existingContact.value,
            })
          );
          expect(error._tag).toBe("FailedToUpdateContactError");

          // Neither row was rewritten.
          const holder = yield* db
            .select()
            .from(schema.contactTable)
            .where(eq(schema.contactTable.id, emailHolderId));
          expect(holder[0]?.email).toBe("ada@example.com");
          const matched = yield* db
            .select()
            .from(schema.contactTable)
            .where(eq(schema.contactTable.id, ssoContactId));
          expect(matched[0]?.email).toBeNull();
        })
    );
  });
});
