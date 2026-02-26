import { DB } from "@feeblo/db";
import { site as siteTable } from "@feeblo/db/schema/feedback";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { Site } from "./schema";

export class SiteRepository extends Effect.Service<SiteRepository>()(
  "SiteRepository",
  {
    effect: Effect.gen(function* () {
      const db = yield* DB;

      return {
        findMany: ({ organizationId }: { organizationId: string }) =>
          Effect.gen(function* () {
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
              .where(eq(siteTable.organizationId, organizationId));

            return sites.map((entry) => new Site(entry));
          }),
      };
    }),
  }
) {}
