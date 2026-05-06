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
                id: schema.site.id,
                name: schema.site.name,
                subdomain: schema.site.subdomain,
                customDomain: schema.site.customDomain,
                changelogVisibility: schema.site.changelogVisibility,
                roadmapVisibility: schema.site.roadmapVisibility,
                createdAt: schema.site.createdAt,
                updatedAt: schema.site.updatedAt,
                organizationId: schema.site.organizationId,
                hidePoweredBy: schema.site.hidePoweredBy,
              })
              .from(schema.site)
              .where(eq(schema.site.organizationId, input.organizationId))
              .limit(1)
          )
        )(args)
        .pipe(Effect.map(EffectArray.get(0))),

    findMany: (findManyArgs: findManyArgs) => {
      const where: SQL[] = [];
      if (findManyArgs.organizationId) {
        where.push(eq(schema.site.organizationId, findManyArgs.organizationId));
      }
      if (findManyArgs.subdomain) {
        where.push(eq(schema.site.subdomain, findManyArgs.subdomain));
      }

      const whereClause = where.length > 1 ? and(...where) : where[0];

      return db.makeQuery(
        (execute, input: { whereClause: SQL | undefined; limit: number }) =>
          execute((client) =>
            client
              .select({
                id: schema.site.id,
                name: schema.site.name,
                subdomain: schema.site.subdomain,
                customDomain: schema.site.customDomain,
                changelogVisibility: schema.site.changelogVisibility,
                roadmapVisibility: schema.site.roadmapVisibility,
                createdAt: schema.site.createdAt,
                updatedAt: schema.site.updatedAt,
                organizationId: schema.site.organizationId,
                hidePoweredBy: schema.site.hidePoweredBy,
              })
              .from(schema.site)
              .where(input.whereClause)
              .limit(input.limit)
          )
      )({ whereClause, limit: findManyArgs.limit });
    },
    update: (args: updateArgs) =>
      Effect.gen(function* () {
        yield* db.makeQuery((execute, input: updateArgs) =>
          execute((client) =>
            client
              .update(schema.site)
              .set({
                changelogVisibility: input.changelogVisibility,
                updatedAt: new Date(),
                roadmapVisibility: input.roadmapVisibility,
                name: input.name,
              })
              .where(
                and(
                  eq(schema.site.id, input.id),
                  eq(schema.site.organizationId, input.organizationId)
                )
              )
          )
        )(args);
      }),
    updateHidePoweredByBranding: (args: updateHidePoweredByBrandingArgs) =>
      Effect.gen(function* () {
        yield* db.makeQuery((execute, input: updateHidePoweredByBrandingArgs) =>
          execute((client) =>
            client
              .update(schema.site)
              .set({
                hidePoweredBy: input.hidePoweredBy,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(schema.site.id, input.id),
                  eq(schema.site.organizationId, input.organizationId)
                )
              )
          )
        )(args);
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
