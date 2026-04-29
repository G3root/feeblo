import { DB } from "@feeblo/db";
import { site as siteTable } from "@feeblo/db/schema/feedback";
import { and, eq, type SQL } from "drizzle-orm";
import { Effect } from "effect";

const makeSiteRepository = Effect.gen(function* () {
  const db = yield* DB;

  return {
    findMany: ({
      organizationId,
      subdomain,
      limit,
    }: {
      organizationId?: string;
      subdomain?: string;
      limit: number;
    }) =>
      Effect.gen(function* () {
        const where: SQL[] = [];
        if (organizationId) {
          where.push(eq(siteTable.organizationId, organizationId));
        }
        if (subdomain) {
          where.push(eq(siteTable.subdomain, subdomain));
        }

        const whereClause = where.length > 1 ? and(...where) : where[0];

        const sites = yield* db
          .select({
            id: siteTable.id,
            name: siteTable.name,
            subdomain: siteTable.subdomain,
            customDomain: siteTable.customDomain,
            changelogVisibility: siteTable.changelogVisibility,
            roadmapVisibility: siteTable.roadmapVisibility,
            createdAt: siteTable.createdAt,
            updatedAt: siteTable.updatedAt,
            organizationId: siteTable.organizationId,
            hidePoweredBy: siteTable.hidePoweredBy,
          })
          .from(siteTable)
          .where(whereClause)
          .limit(limit);

        return sites;
      }),
    update: ({
      id,
      organizationId,
      changelogVisibility,
      roadmapVisibility,
      name,
    }: {
      id: string;
      organizationId: string;
      changelogVisibility: "PUBLIC" | "HIDDEN";
      roadmapVisibility: "PUBLIC" | "HIDDEN";
      name: string;
    }) =>
      Effect.gen(function* () {
        yield* db
          .update(siteTable)
          .set({
            changelogVisibility,
            updatedAt: new Date(),
            roadmapVisibility,
            name,
          })
          .where(
            and(
              eq(siteTable.id, id),
              eq(siteTable.organizationId, organizationId)
            )
          );
      }),
    updateHidePoweredByBranding: ({
      id,
      organizationId,
      hidePoweredBy,
    }: {
      id: string;
      organizationId: string;
      hidePoweredBy: boolean;
    }) =>
      Effect.gen(function* () {
        yield* db
          .update(siteTable)
          .set({
            hidePoweredBy,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(siteTable.id, id),
              eq(siteTable.organizationId, organizationId)
            )
          );
      }),
  };
});

export class SiteRepository extends Effect.Service<SiteRepository>()(
  "SiteRepository",
  {
    effect: makeSiteRepository,
  }
) {
  static readonly layer = this.Default;
}
