import { currentDb, schema } from "@feeblo/db";
import { and, eq, type SQL } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as EffectArray from "effect/Array";
import * as Layer from "effect/Layer";

interface findByOrganizationIdArgs {
  organizationId: string;
}
interface findManyArgs {
  limit: number;
  organizationId?: string;
  subdomain?: string;
}

interface updateArgs {
  changelogVisibility: "PUBLIC" | "HIDDEN";
  id: string;
  name: string;
  organizationId: string;
  roadmapVisibility: "PUBLIC" | "HIDDEN";
}

interface updateHidePoweredByBrandingArgs {
  hidePoweredBy: boolean;
  id: string;
  organizationId: string;
}

const makeSiteRepository = Effect.gen(function* () {
  return {
    findByOrganizationId: ({ organizationId }: findByOrganizationIdArgs) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .select({
            id: schema.siteTable.id,
            name: schema.siteTable.name,
            subdomain: schema.siteTable.subdomain,
            customDomain: schema.siteTable.customDomain,
            changelogVisibility: schema.siteTable.changelogVisibility,
            roadmapVisibility: schema.siteTable.roadmapVisibility,
            createdAt: schema.siteTable.createdAt,
            updatedAt: schema.siteTable.updatedAt,
            organizationId: schema.siteTable.organizationId,
            hidePoweredBy: schema.siteTable.hidePoweredBy,
          })
          .from(schema.siteTable)
          .where(eq(schema.siteTable.organizationId, organizationId))
          .limit(1)
          .pipe(Effect.map(EffectArray.get(0)));
      }),

    findMany: (findManyArgs: findManyArgs) => {
      const where: SQL[] = [];
      if (findManyArgs.organizationId) {
        where.push(
          eq(schema.siteTable.organizationId, findManyArgs.organizationId)
        );
      }
      if (findManyArgs.subdomain) {
        where.push(eq(schema.siteTable.subdomain, findManyArgs.subdomain));
      }

      const whereClause = where.length > 1 ? and(...where) : where[0];

      return Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .select({
            id: schema.siteTable.id,
            name: schema.siteTable.name,
            subdomain: schema.siteTable.subdomain,
            customDomain: schema.siteTable.customDomain,
            changelogVisibility: schema.siteTable.changelogVisibility,
            roadmapVisibility: schema.siteTable.roadmapVisibility,
            createdAt: schema.siteTable.createdAt,
            updatedAt: schema.siteTable.updatedAt,
            organizationId: schema.siteTable.organizationId,
            hidePoweredBy: schema.siteTable.hidePoweredBy,
          })
          .from(schema.siteTable)
          .where(whereClause)
          .limit(findManyArgs.limit);
      });
    },
    update: ({
      changelogVisibility,
      id,
      name,
      organizationId,
      roadmapVisibility,
    }: updateArgs) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        yield* db
          .update(schema.siteTable)
          .set({
            changelogVisibility,
            updatedAt: new Date(),
            roadmapVisibility,
            name,
          })
          .where(
            and(
              eq(schema.siteTable.id, id),
              eq(schema.siteTable.organizationId, organizationId)
            )
          )
          .pipe(Effect.asVoid);
      }),
    updateHidePoweredByBranding: ({
      hidePoweredBy,
      id,
      organizationId,
    }: updateHidePoweredByBrandingArgs) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        yield* db
          .update(schema.siteTable)
          .set({
            hidePoweredBy,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.siteTable.id, id),
              eq(schema.siteTable.organizationId, organizationId)
            )
          )
          .pipe(Effect.asVoid);
      }),
  };
});

export class SiteRepository extends Context.Service<SiteRepository>()(
  "SiteRepository",
  {
    make: makeSiteRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
