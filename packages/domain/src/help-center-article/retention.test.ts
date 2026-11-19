import { expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import { asc, eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { HelpCenterArticleRepository } from "./repository";
import { HELP_CENTER_SEARCH_RETENTION_DAYS } from "./retention";
import { HELP_CENTER_ANALYTICS_RANGE_DAYS } from "./schema";

const TestLayer = HelpCenterArticleRepository.layer.pipe(
  Layer.provideMerge(Database.PgliteDatabaseLive)
);

/**
 * The search bucket's prune, tested at the repository the sweep calls.
 *
 * The sweep itself repeats forever and is not the thing under test; what
 * matters is that deleting "before a day" leaves the cut day alone, because
 * the analytics windows are inclusive ranges of days.
 */
layer(TestLayer)("search retention", (it) => {
  const seed = (organizationId: string, days: readonly string[]) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const now = yield* DateTime.nowAsDate;

      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "Retention",
        slug: organizationId,
        createdAt: now,
      });

      yield* db.insert(schema.helpCenterSearchDailyTable).values(
        days.map((day) => ({
          day,
          emptySearches: 0,
          organizationId,
          query: `query-${day}`,
          searches: 1,
        }))
      );
    });

  /** The days still stored for one workspace. The file shares a database. */
  const remainingDays = (organizationId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;

      const rows = yield* db
        .select({ day: schema.helpCenterSearchDailyTable.day })
        .from(schema.helpCenterSearchDailyTable)
        .where(
          eq(schema.helpCenterSearchDailyTable.organizationId, organizationId)
        )
        .orderBy(asc(schema.helpCenterSearchDailyTable.day));

      return rows.map((row) => row.day);
    });

  it.effect("deletes the days before the cut and keeps the cut day", () =>
    Effect.gen(function* () {
      const repository = yield* HelpCenterArticleRepository;
      const organizationId = yield* WorkspaceId.generate;

      yield* seed(organizationId, ["2026-01-01", "2026-01-09", "2026-01-10"]);

      yield* repository.deleteSearchesBefore("2026-01-10");

      const rows = yield* remainingDays(organizationId);

      // `day < before`, so the day named is retained. A window that starts on
      // that day still has its first day.
      expect(rows).toStrictEqual(["2026-01-10"]);
    })
  );

  it.effect("keeps at least the longest analytics window", () =>
    Effect.sync(() => {
      // The panel's 90-day range includes today and the 89 before it; a
      // retention window shorter than that would delete a day a page reports.
      expect(HELP_CENTER_SEARCH_RETENTION_DAYS).toBeGreaterThanOrEqual(
        HELP_CENTER_ANALYTICS_RANGE_DAYS["90d"]
      );
    })
  );
});
