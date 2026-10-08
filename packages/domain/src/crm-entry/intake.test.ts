import { expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { EntitlementPolicy } from "../entitlement/policies";
import { WorkspaceRepository } from "../workspace/repository";
import { createCrmEntry, ensureCrmEntry } from "./intake";

/**
 * The intake protocol's own tests.
 *
 * They drive the interface every creation path crosses — the lock, the count,
 * the allowance, the find-before-allowance order, and the lost-race recovery —
 * against PGlite and the real `EntitlementPolicy`. The surfaces' suites still
 * exercise their own paths; these pin the protocol itself, including the
 * branches the plan catalogue cannot currently reach (a plan with both a
 * capped CRM and a path that creates entries).
 */

const TestLayer = Layer.mergeAll(
  EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer)),
  WorkspaceRepository.layer
).pipe(Layer.provideMerge(Database.PgliteDatabaseLive));

/** `PLAN_ENTITLEMENTS.free.limits.crmEntries`, restated so a change fails here. */
const FREE_CRM_ENTRY_LIMIT = 10;

/** A workspace with no subscription resolves to `free`, the capped plan. */
const makeOrganization = Effect.gen(function* () {
  const db = yield* currentDb;
  const organizationId = yield* WorkspaceId.generate;
  const now = yield* DateTime.nowAsDate;

  yield* db.insert(schema.organizationTable).values({
    id: organizationId,
    name: "CRM intake workspace",
    slug: organizationId,
    createdAt: now,
  });

  return organizationId;
});

const fillContacts = (organizationId: string, count: number) =>
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

const fillCompanies = (organizationId: string, count: number) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const now = yield* DateTime.nowAsDate;
    yield* db.insert(schema.companyTable).values(
      Array.from({ length: count }, (_, index) => ({
        id: `company_filler_${organizationId}_${index}`,
        organizationId,
        name: `Filler ${index}`,
        createdAt: now,
        updatedAt: now,
      }))
    );
  });

layer(TestLayer)("CRM entry intake", (it) => {
  it.effect("creates an entry while the plan has room", () =>
    Effect.gen(function* () {
      const organizationId = yield* makeOrganization;
      const created = yield* createCrmEntry({
        organizationId,
        insert: Effect.succeed("created"),
      });

      expect(created).toBe("created");
    })
  );

  it.effect("refuses a create once the plan is at its cap", () =>
    Effect.gen(function* () {
      const organizationId = yield* makeOrganization;
      yield* fillContacts(organizationId, FREE_CRM_ENTRY_LIMIT);

      const error = yield* Effect.flip(
        createCrmEntry({
          organizationId,
          insert: Effect.succeed("created"),
        })
      );

      expect(error._tag).toBe("PolicyDenied");
    })
  );

  it.effect("counts companies and contacts together against the cap", () =>
    Effect.gen(function* () {
      const organizationId = yield* makeOrganization;
      // Neither table alone is at the cap; together they are.
      yield* fillContacts(organizationId, FREE_CRM_ENTRY_LIMIT - 1);
      yield* fillCompanies(organizationId, 1);

      const error = yield* Effect.flip(
        createCrmEntry({
          organizationId,
          insert: Effect.succeed("created"),
        })
      );

      expect(error._tag).toBe("PolicyDenied");
    })
  );

  it.effect(
    "returns an existing entry at the cap without running the insert",
    () =>
      Effect.gen(function* () {
        const organizationId = yield* makeOrganization;
        yield* fillContacts(organizationId, FREE_CRM_ENTRY_LIMIT);

        const found = yield* ensureCrmEntry({
          organizationId,
          find: Effect.succeed(Option.some("existing")),
          insert: Effect.die(
            new Error("the insert must not run when a row already exists")
          ),
          onLostRace: Effect.die(new Error("no race was lost")),
        });

        expect(found).toBe("existing");
      })
  );

  it.effect("creates an entry when the lookup finds nothing", () =>
    Effect.gen(function* () {
      const organizationId = yield* makeOrganization;

      const created = yield* ensureCrmEntry({
        organizationId,
        find: Effect.succeed(Option.none<string>()),
        insert: Effect.succeed(Option.some("created")),
        onLostRace: Effect.die(new Error("no race was lost")),
      });

      expect(created).toBe("created");
    })
  );

  it.effect(
    "answers with the winner when the insert loses a unique-key race",
    () =>
      Effect.gen(function* () {
        const organizationId = yield* makeOrganization;
        let lookups = 0;
        const found = yield* ensureCrmEntry({
          organizationId,
          // Absent before the insert, present after it: the concurrent
          // writer's row is what the re-read must return.
          find: Effect.sync(() => {
            lookups += 1;
            return lookups === 1
              ? Option.none<string>()
              : Option.some("winner");
          }),
          insert: Effect.succeed(Option.none<string>()),
          onLostRace: Effect.die(new Error("the winner must be found")),
        });

        expect(found).toBe("winner");
        expect(lookups).toBe(2);
      })
  );

  it.effect("runs the caller's failure when no winner can be found", () =>
    Effect.gen(function* () {
      const organizationId = yield* makeOrganization;

      const error = yield* Effect.flip(
        ensureCrmEntry({
          organizationId,
          find: Effect.succeed(Option.none<string>()),
          insert: Effect.succeed(Option.none<string>()),
          onLostRace: Effect.fail("lost" as const),
        })
      );

      expect(error).toBe("lost");
    })
  );
});
