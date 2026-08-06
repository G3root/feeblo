import { currentDb, schema } from "@feeblo/db";
import { and, asc, eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { TChangelogCategory } from "./schema";

interface TFindMany {
  organizationId: string;
}

interface TCountByOrganizationId {
  organizationId: string;
}

interface TCreate {
  icon: string;
  iconType: TChangelogCategory["iconType"];
  id: string;
  name: string;
  organizationId: string;
}

interface TUpdate {
  icon: string;
  iconType: TChangelogCategory["iconType"];
  id: string;
  name: string;
  organizationId: string;
}

interface TDelete {
  id: string;
  organizationId: string;
}

const makeChangelogCategoryRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  return {
    findMany: ({ organizationId }: TFindMany) =>
      db
        .select({
          id: schema.changelogCategoryTable.id,
          name: schema.changelogCategoryTable.name,
          iconType: schema.changelogCategoryTable.iconType,
          icon: schema.changelogCategoryTable.icon,
          organizationId: schema.changelogCategoryTable.organizationId,
          createdAt: schema.changelogCategoryTable.createdAt,
          updatedAt: schema.changelogCategoryTable.updatedAt,
        })
        .from(schema.changelogCategoryTable)
        .where(eq(schema.changelogCategoryTable.organizationId, organizationId))
        .orderBy(asc(schema.changelogCategoryTable.createdAt)),

    countByOrganizationId: ({ organizationId }: TCountByOrganizationId) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ id: schema.changelogCategoryTable.id })
          .from(schema.changelogCategoryTable)
          .where(
            eq(schema.changelogCategoryTable.organizationId, organizationId)
          );
        return rows.length;
      }),

    create: ({ id, name, iconType, icon, organizationId }: TCreate) =>
      db
        .insert(schema.changelogCategoryTable)
        .values({
          id,
          name,
          iconType,
          icon,
          organizationId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .pipe(Effect.asVoid),

    update: ({ id, name, iconType, icon, organizationId }: TUpdate) =>
      db
        .update(schema.changelogCategoryTable)
        .set({
          name,
          iconType,
          icon,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.changelogCategoryTable.id, id),
            eq(schema.changelogCategoryTable.organizationId, organizationId)
          )
        )
        .pipe(Effect.asVoid),

    delete: ({ id, organizationId }: TDelete) =>
      db
        .delete(schema.changelogCategoryTable)
        .where(
          and(
            eq(schema.changelogCategoryTable.id, id),
            eq(schema.changelogCategoryTable.organizationId, organizationId)
          )
        )
        .pipe(Effect.asVoid),
  };
});

export class ChangelogCategoryRepository extends Context.Service<ChangelogCategoryRepository>()(
  "ChangelogCategoryRepository",
  {
    make: makeChangelogCategoryRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
