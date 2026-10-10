import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import { and, eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import {
  unsubscribeNotificationPreference,
  validateNotificationPreferenceUnsubscribeToken,
} from "./api-live";
import { NotificationPreferenceRepository } from "./repository";
import { NotificationPreferenceTokenService } from "./tokens";

const TestLayer = Layer.mergeAll(
  NotificationPreferenceRepository.layer.pipe(
    Layer.provide(Database.PgliteDatabaseLive)
  ),
  NotificationPreferenceTokenService.layerTest(
    "notification-preference-api-test-secret"
  ),
  Database.PgliteDatabaseLive
);

describe("unsubscribeNotificationPreference", () => {
  layer(TestLayer)("one-click unsubscribe", (it) => {
    const makeFixture = () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const organizationId = yield* WorkspaceId.generate;
        const userId = `user_${organizationId}`;
        const now = yield* DateTime.nowAsDate;
        yield* db.insert(schema.organizationTable).values({
          id: organizationId,
          name: "Preference API org",
          slug: organizationId,
          createdAt: now,
        });
        yield* db.insert(schema.userTable).values({
          id: userId,
          email: `${userId}@example.test`,
          name: "Member",
          emailVerified: true,
        });
        return { organizationId, userId };
      });

    it.effect("disables exactly the category the token names", () =>
      Effect.gen(function* () {
        const tokens = yield* NotificationPreferenceTokenService;
        const repository = yield* NotificationPreferenceRepository;
        const db = yield* currentDb;
        const fixture = yield* makeFixture();
        const token = yield* tokens.deriveToken({
          category: "changelog_published",
          organizationId: fixture.organizationId,
          userId: fixture.userId,
        });

        expect(
          yield* unsubscribeNotificationPreference(Redacted.value(token))
        ).toEqual({ unsubscribed: true });

        const rows = yield* db
          .select({
            category: schema.notificationPreferenceTable.category,
            enabled: schema.notificationPreferenceTable.enabled,
          })
          .from(schema.notificationPreferenceTable)
          .where(
            and(
              eq(
                schema.notificationPreferenceTable.organizationId,
                fixture.organizationId
              ),
              eq(schema.notificationPreferenceTable.userId, fixture.userId)
            )
          );
        expect(rows).toEqual([
          { category: "changelog_published", enabled: false },
        ]);
        expect(
          yield* repository.listForRecipient({
            organizationId: fixture.organizationId,
            userId: fixture.userId,
          })
        ).toEqual([{ category: "changelog_published", enabled: false }]);
      })
    );

    it.effect("is idempotent on a replayed click", () =>
      Effect.gen(function* () {
        const tokens = yield* NotificationPreferenceTokenService;
        const fixture = yield* makeFixture();
        const token = yield* tokens.deriveToken({
          category: "new_feedback",
          organizationId: fixture.organizationId,
          userId: fixture.userId,
        });
        const url = Redacted.value(token);

        expect(yield* unsubscribeNotificationPreference(url)).toEqual({
          unsubscribed: true,
        });
        expect(yield* unsubscribeNotificationPreference(url)).toEqual({
          unsubscribed: true,
        });
      })
    );

    it.effect("validates a GET link without changing any preference", () =>
      Effect.gen(function* () {
        const tokens = yield* NotificationPreferenceTokenService;
        const db = yield* currentDb;
        const fixture = yield* makeFixture();
        const token = yield* tokens.deriveToken({
          category: "new_feedback",
          organizationId: fixture.organizationId,
          userId: fixture.userId,
        });

        expect(
          yield* validateNotificationPreferenceUnsubscribeToken(
            Redacted.value(token)
          )
        ).toEqual({ valid: true });

        // A link prefetch must not have written an opt-out row.
        const rows = yield* db
          .select({ id: schema.notificationPreferenceTable.id })
          .from(schema.notificationPreferenceTable)
          .where(
            eq(
              schema.notificationPreferenceTable.organizationId,
              fixture.organizationId
            )
          );
        expect(rows).toEqual([]);
      })
    );

    it.effect("rejects a forged GET link", () =>
      Effect.gen(function* () {
        yield* makeFixture();
        const error = yield* Effect.flip(
          validateNotificationPreferenceUnsubscribeToken("forged.token")
        );

        expect(error._tag).toBe("BadRequestError");
      })
    );

    it.effect("rejects a forged token without writing a row", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const fixture = yield* makeFixture();
        const error = yield* Effect.flip(
          unsubscribeNotificationPreference("forged.token")
        );

        expect(error._tag).toBe("BadRequestError");
        const rows = yield* db
          .select({ id: schema.notificationPreferenceTable.id })
          .from(schema.notificationPreferenceTable)
          .where(
            eq(
              schema.notificationPreferenceTable.organizationId,
              fixture.organizationId
            )
          );
        expect(rows).toEqual([]);
      })
    );
  });
});
