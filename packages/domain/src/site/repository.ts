import { Database, schema } from "@feeblo/db";
import { and, eq, type SQL } from "drizzle-orm";
import { Context, Effect, Array as EffectArray, Layer } from "effect";

interface findByOrganizationIdArgs {
  organizationId: string;
}
interface findManyArgs {
  limit: number;
  organizationId?: string;
  subdomain?: string;
}

interface findManyQuery {
  limit: number;
  whereClause: SQL | undefined;
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
  const db = yield* Database.Database;

  return {
    findByOrganizationId: (args: findByOrganizationIdArgs) =>
      db
        .makeQuery((execute, input: findByOrganizationIdArgs) =>
          execute((client) =>
            client
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
              .where(eq(schema.siteTable.organizationId, input.organizationId))
              .limit(1)
          )
        )(args)
        .pipe(Effect.map(EffectArray.get(0))),

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

      return db.makeQuery((execute, input: findManyQuery) =>
        execute((client) =>
          client
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
            .where(input.whereClause)
            .limit(input.limit)
        )
      )({ whereClause, limit: findManyArgs.limit });
    },
    update: (args: updateArgs) =>
      db
        .makeQuery((execute, input: updateArgs) =>
          execute((client) =>
            client
              .update(schema.siteTable)
              .set({
                changelogVisibility: input.changelogVisibility,
                updatedAt: new Date(),
                roadmapVisibility: input.roadmapVisibility,
                name: input.name,
              })
              .where(
                and(
                  eq(schema.siteTable.id, input.id),
                  eq(schema.siteTable.organizationId, input.organizationId)
                )
              )
          )
        )(args)
        .pipe(Effect.asVoid),
    updateHidePoweredByBranding: (args: updateHidePoweredByBrandingArgs) =>
      db
        .makeQuery((execute, input: updateHidePoweredByBrandingArgs) =>
          execute((client) =>
            client
              .update(schema.siteTable)
              .set({
                hidePoweredBy: input.hidePoweredBy,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(schema.siteTable.id, input.id),
                  eq(schema.siteTable.organizationId, input.organizationId)
                )
              )
          )
        )(args)
        .pipe(Effect.asVoid),
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
