import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import { and, eq, isNull } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EmailSuppressionRepository } from "./repository";

describe("EmailSuppressionRepository", () => {
  const TestLayer = EmailSuppressionRepository.layer.pipe(
    Layer.provideMerge(Database.PgliteDatabaseLive)
  );

  const createOrganization = Effect.fnUntraced(function* () {
    const db = yield* currentDb;
    const organizationId = yield* WorkspaceId.generate;
    const now = yield* DateTime.nowAsDate;
    yield* db.insert(schema.organizationTable).values({
      id: organizationId,
      name: "Suppression workspace",
      slug: organizationId,
      createdAt: now,
    });
    return organizationId;
  });

  const rowsFor = (email: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      return yield* db
        .select()
        .from(schema.emailSuppressionTable)
        .where(eq(schema.emailSuppressionTable.email, email));
    });

  layer(TestLayer)("repository", (it) => {
    it.effect("normalizes an address and creates one row per scope", () =>
      Effect.gen(function* () {
        const repository = yield* EmailSuppressionRepository;
        const organizationId = yield* createOrganization();
        const now = yield* DateTime.nowAsDate;

        yield* repository.upsert({
          email: " Suppressed@Example.com ",
          now,
          organizationId,
          providerEventId: "evt_1",
          reason: "hard_bounce",
        });
        yield* repository.upsert({
          email: "suppressed@example.com",
          now,
          organizationId: null,
          providerEventId: null,
          reason: "hard_bounce",
        });

        const rows = yield* rowsFor("suppressed@example.com");
        expect(rows).toHaveLength(2);
        expect(
          rows
            .map((row) => row.organizationId)
            .sort((left, right) => (left ?? "").localeCompare(right ?? ""))
        ).toEqual(
          [null, organizationId].sort((left, right) =>
            (left ?? "").localeCompare(right ?? "")
          )
        );
        expect(
          yield* repository.isSuppressed({
            email: "SUPPRESSED@example.com",
            organizationId,
          })
        ).toBe(true);
        expect(
          yield* repository.isSuppressed({
            email: "suppressed@example.com",
            organizationId: null,
          })
        ).toBe(true);
      })
    );

    it.effect("is idempotent for the same address and event", () =>
      Effect.gen(function* () {
        const repository = yield* EmailSuppressionRepository;
        const organizationId = yield* createOrganization();
        const now = yield* DateTime.nowAsDate;

        yield* repository.upsert({
          email: "repeat@example.com",
          now,
          organizationId,
          providerEventId: "evt_repeat",
          reason: "hard_bounce",
        });
        yield* repository.upsert({
          email: "repeat@example.com",
          now,
          organizationId,
          providerEventId: "evt_repeat",
          reason: "hard_bounce",
        });

        expect(yield* rowsFor("repeat@example.com")).toHaveLength(1);
      })
    );

    it.effect("never weakens a stronger reason and keeps the first cause", () =>
      Effect.gen(function* () {
        const repository = yield* EmailSuppressionRepository;
        const organizationId = yield* createOrganization();
        const now = yield* DateTime.nowAsDate;

        yield* repository.upsert({
          email: "precedence@example.com",
          note: "Blocked by an operator",
          now,
          organizationId,
          providerEventId: null,
          reason: "administrative_block",
        });
        yield* repository.upsert({
          email: "precedence@example.com",
          now,
          organizationId,
          providerEventId: "evt_bounce",
          reason: "hard_bounce",
        });

        const [row] = yield* rowsFor("precedence@example.com");
        expect(row).toMatchObject({
          firstReason: "administrative_block",
          note: "Blocked by an operator",
          reason: "administrative_block",
        });

        yield* repository.upsert({
          email: "precedence@example.com",
          now,
          organizationId,
          providerEventId: "evt_complaint",
          reason: "complaint",
        });

        const [afterComplaint] = yield* rowsFor("precedence@example.com");
        // A manual note survives a provider event that did not carry one.
        expect(afterComplaint).toMatchObject({
          firstReason: "administrative_block",
          note: "Blocked by an operator",
          reason: "complaint",
        });
      })
    );

    it.effect("does not let one workspace's row silence another", () =>
      Effect.gen(function* () {
        const repository = yield* EmailSuppressionRepository;
        const first = yield* createOrganization();
        const second = yield* createOrganization();
        const now = yield* DateTime.nowAsDate;

        yield* repository.upsert({
          email: "tenant-scoped@example.com",
          now,
          organizationId: first,
          providerEventId: null,
          reason: "complaint",
        });

        expect(
          yield* repository.isSuppressed({
            email: "tenant-scoped@example.com",
            organizationId: first,
          })
        ).toBe(true);
        expect(
          yield* repository.isSuppressed({
            email: "tenant-scoped@example.com",
            organizationId: second,
          })
        ).toBe(false);
        // Auth mail reads platform rows only and must not inherit a
        // workspace's complaint.
        expect(
          yield* repository.isSuppressed({
            email: "tenant-scoped@example.com",
            organizationId: null,
          })
        ).toBe(false);
      })
    );

    it.effect("filters a batch and ignores malformed lookups", () =>
      Effect.gen(function* () {
        const repository = yield* EmailSuppressionRepository;
        const organizationId = yield* createOrganization();
        const now = yield* DateTime.nowAsDate;

        yield* repository.upsert({
          email: "batch@example.com",
          now,
          organizationId: null,
          providerEventId: null,
          reason: "hard_bounce",
        });

        const suppressed = yield* repository.findSuppressedEmails({
          emails: ["BATCH@example.com", "clear@example.com", "not an email"],
          organizationId,
        });
        expect([...suppressed]).toEqual(["batch@example.com"]);
        expect(
          yield* repository.isSuppressed({
            email: "not an email",
            organizationId,
          })
        ).toBe(false);
      })
    );

    it.effect("lists only the workspace rows and counts them by reason", () =>
      Effect.gen(function* () {
        const repository = yield* EmailSuppressionRepository;
        const organizationId = yield* createOrganization();
        const otherOrganizationId = yield* createOrganization();
        const now = yield* DateTime.nowAsDate;

        for (const email of ["first@example.com", "second@example.com"]) {
          yield* repository.upsert({
            email,
            now,
            organizationId,
            providerEventId: null,
            reason: "hard_bounce",
          });
        }
        yield* repository.upsert({
          email: "blocked@example.com",
          note: "Abuse report",
          now,
          organizationId,
          providerEventId: null,
          reason: "administrative_block",
        });
        yield* repository.upsert({
          email: "other-tenant@example.com",
          now,
          organizationId: otherOrganizationId,
          providerEventId: null,
          reason: "complaint",
        });
        yield* repository.upsert({
          email: "platform@example.com",
          now,
          organizationId: null,
          providerEventId: null,
          reason: "hard_bounce",
        });

        const all = yield* repository.list({
          limit: 10,
          offset: 0,
          organizationId,
        });
        expect(all.total).toBe(3);
        expect(all.items.map((item) => item.email).sort()).toEqual([
          "blocked@example.com",
          "first@example.com",
          "second@example.com",
        ]);

        const search = yield* repository.list({
          limit: 10,
          offset: 0,
          organizationId,
          search: "BLOCK",
        });
        expect(search.items.map((item) => item.email)).toEqual([
          "blocked@example.com",
        ]);

        const byReason = yield* repository.list({
          limit: 10,
          offset: 0,
          organizationId,
          reason: "hard_bounce",
        });
        expect(byReason.total).toBe(2);

        const stats = yield* repository.stats(organizationId);
        expect(stats).toEqual({
          administrativeBlock: 1,
          complaint: 0,
          hardBounce: 2,
          total: 3,
        });
      })
    );

    it.effect("removes only a row this workspace owns", () =>
      Effect.gen(function* () {
        const repository = yield* EmailSuppressionRepository;
        const organizationId = yield* createOrganization();
        const otherOrganizationId = yield* createOrganization();
        const now = yield* DateTime.nowAsDate;

        yield* repository.upsert({
          email: "removable@example.com",
          now,
          organizationId,
          providerEventId: null,
          reason: "complaint",
        });
        yield* repository.upsert({
          email: "foreign@example.com",
          now,
          organizationId: otherOrganizationId,
          providerEventId: null,
          reason: "complaint",
        });

        expect(
          yield* repository.remove({
            email: "foreign@example.com",
            organizationId,
          })
        ).toEqual({ removed: false });
        expect(
          yield* repository.remove({
            email: "removable@example.com",
            organizationId,
          })
        ).toEqual({ removed: true });
        expect(yield* rowsFor("foreign@example.com")).toHaveLength(1);
        expect(yield* rowsFor("removable@example.com")).toHaveLength(0);
      })
    );

    it.effect("cascades a workspace row when its organization is deleted", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const repository = yield* EmailSuppressionRepository;
        const organizationId = yield* createOrganization();
        const now = yield* DateTime.nowAsDate;

        yield* repository.upsert({
          email: "erased@example.com",
          now,
          organizationId,
          providerEventId: null,
          reason: "complaint",
        });
        yield* db
          .delete(schema.organizationTable)
          .where(eq(schema.organizationTable.id, organizationId));

        const remaining = yield* db
          .select({ email: schema.emailSuppressionTable.email })
          .from(schema.emailSuppressionTable)
          .where(
            and(
              eq(schema.emailSuppressionTable.email, "erased@example.com"),
              isNull(schema.emailSuppressionTable.organizationId)
            )
          );
        expect(remaining).toHaveLength(0);
      })
    );
  });
});
