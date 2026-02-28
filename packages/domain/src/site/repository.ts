import { DB } from "@feeblo/db";
import { site as siteTable } from "@feeblo/db/schema/feedback";
import { and, eq, type SQL } from "drizzle-orm";
import { Effect } from "effect";
import { Site } from "./schema";

export class SiteRepository extends Effect.Service<SiteRepository>()(
  "SiteRepository",
  {
    effect: Effect.gen(function* () {
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
                createdAt: siteTable.createdAt,
                updatedAt: siteTable.updatedAt,
                organizationId: siteTable.organizationId,
              })
              .from(siteTable)
              .where(whereClause)
              .limit(limit);

            return sites.map((entry) => new Site(entry));
          }),
      };
    }),
  }
) {}
