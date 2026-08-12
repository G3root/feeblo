import { currentDb, schema } from "@feeblo/db";
import { ChangelogCategoryLinkId } from "@feeblo/id";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { TChangelogCategory, TChangelogCategorySet } from "./schema";

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

interface TCountExistingCategories {
  categoryIds: readonly string[];
  organizationId: string;
}

interface THasChangelog {
  changelogId: string;
  organizationId: string;
}

const makeChangelogCategoryRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  const findLinks = ({ organizationId }: { organizationId: string }) =>
    db
      .select({
        id: schema.changelogCategoryLinkTable.id,
        changelogId: schema.changelogCategoryLinkTable.changelogId,
        categoryId: schema.changelogCategoryLinkTable.categoryId,
        organizationId: schema.changelogCategoryLinkTable.organizationId,
        createdAt: schema.changelogCategoryLinkTable.createdAt,
        updatedAt: schema.changelogCategoryLinkTable.updatedAt,
      })
      .from(schema.changelogCategoryLinkTable)
      .where(
        eq(schema.changelogCategoryLinkTable.organizationId, organizationId)
      )
      .orderBy(asc(schema.changelogCategoryLinkTable.createdAt));

  const findLinksPublished = ({ organizationId }: { organizationId: string }) =>
    db
      .select({
        id: schema.changelogCategoryLinkTable.id,
        changelogId: schema.changelogCategoryLinkTable.changelogId,
        categoryId: schema.changelogCategoryLinkTable.categoryId,
        organizationId: schema.changelogCategoryLinkTable.organizationId,
        createdAt: schema.changelogCategoryLinkTable.createdAt,
        updatedAt: schema.changelogCategoryLinkTable.updatedAt,
      })
      .from(schema.changelogCategoryLinkTable)
      .innerJoin(
        schema.changelogTable,
        eq(
          schema.changelogCategoryLinkTable.changelogId,
          schema.changelogTable.id
        )
      )
      .where(
        and(
          eq(schema.changelogCategoryLinkTable.organizationId, organizationId),
          eq(schema.changelogTable.status, "published")
        )
      )
      .orderBy(asc(schema.changelogCategoryLinkTable.createdAt));

  return {
    findLinks,
    findLinksPublished,

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
      db
        .select({ count: count() })
        .from(schema.changelogCategoryTable)
        .where(eq(schema.changelogCategoryTable.organizationId, organizationId))
        .pipe(Effect.map((rows) => rows[0]?.count ?? 0)),

    create: ({ id, name, iconType, icon, organizationId }: TCreate) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        yield* db
          .insert(schema.changelogCategoryTable)
          .values({
            id,
            name,
            iconType,
            icon,
            organizationId,
            createdAt: now,
            updatedAt: now,
          })
          .pipe(Effect.asVoid);
      }),

    update: ({ id, name, iconType, icon, organizationId }: TUpdate) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        yield* db
          .update(schema.changelogCategoryTable)
          .set({
            name,
            iconType,
            icon,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.changelogCategoryTable.id, id),
              eq(schema.changelogCategoryTable.organizationId, organizationId)
            )
          )
          .pipe(Effect.asVoid);
      }),

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

    hasChangelog: ({ changelogId, organizationId }: THasChangelog) =>
      db
        .select({ id: schema.changelogTable.id })
        .from(schema.changelogTable)
        .where(
          and(
            eq(schema.changelogTable.id, changelogId),
            eq(schema.changelogTable.organizationId, organizationId)
          )
        )
        .limit(1)
        .pipe(Effect.map((rows) => rows.length === 1)),

    countExistingCategories: ({
      categoryIds,
      organizationId,
    }: TCountExistingCategories) =>
      db
        .select({ id: schema.changelogCategoryTable.id })
        .from(schema.changelogCategoryTable)
        .where(
          and(
            eq(schema.changelogCategoryTable.organizationId, organizationId),
            inArray(schema.changelogCategoryTable.id, categoryIds)
          )
        )
        .pipe(Effect.map((rows) => rows.length)),

    setChangelogCategories: ({
      changelogId,
      organizationId,
      categoryIds,
    }: TChangelogCategorySet) =>
      db
        .transaction((tx) =>
          Effect.gen(function* () {
            const now = yield* DateTime.nowAsDate;
            yield* tx
              .delete(schema.changelogCategoryLinkTable)
              .where(
                and(
                  eq(
                    schema.changelogCategoryLinkTable.changelogId,
                    changelogId
                  ),
                  eq(
                    schema.changelogCategoryLinkTable.organizationId,
                    organizationId
                  )
                )
              );

            if (categoryIds.length === 0) {
              return;
            }

            const rows = yield* Effect.forEach(categoryIds, (categoryId) =>
              ChangelogCategoryLinkId.generate.pipe(
                Effect.map((id) => ({
                  id,
                  changelogId,
                  categoryId,
                  organizationId,
                  createdAt: now,
                  updatedAt: now,
                }))
              )
            );

            yield* tx
              .insert(schema.changelogCategoryLinkTable)
              .values(rows)
              .onConflictDoNothing();
          })
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
