import { currentDb, schema } from "@feeblo/db";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { THelpCenterTopicDelete, THelpCenterTopicReorder } from "./schema";

const topicColumns = {
  id: schema.helpCenterTopicTable.id,
  organizationId: schema.helpCenterTopicTable.organizationId,
  slug: schema.helpCenterTopicTable.slug,
  name: schema.helpCenterTopicTable.name,
  description: schema.helpCenterTopicTable.description,
  icon: schema.helpCenterTopicTable.icon,
  position: schema.helpCenterTopicTable.position,
  createdAt: schema.helpCenterTopicTable.createdAt,
  updatedAt: schema.helpCenterTopicTable.updatedAt,
} as const;

/** Topics in display order. `name` breaks a tie so the order is total. */
const displayOrder = [
  asc(schema.helpCenterTopicTable.position),
  asc(schema.helpCenterTopicTable.name),
] as const;

/**
 * The create's stored fields.
 *
 * Spelled out rather than reused from the RPC schema: `position` is optional on
 * the wire (an omitted position appends) and required here (the handler always
 * resolves one before writing). Reusing the wire type would push an `undefined`
 * into the insert under `exactOptionalPropertyTypes`.
 */
interface TCreateTopic {
  description: string | null;
  icon: string | null;
  id: string;
  name: string;
  organizationId: string;
  position: number;
  slug: string;
}

interface TUpdateTopic {
  description: string | null;
  icon: string | null;
  id: string;
  name: string;
  organizationId: string;
  slug: string;
}

const makeHelpCenterTopicRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  /**
   * The dashboard's list: every topic, with the number of articles filed
   * under it whatever their state.
   *
   * The count is a correlated subquery rather than a join-and-group so a topic
   * with no articles still appears, which is the common case for a workspace
   * that has just created its first topic.
   */
  const findMany = ({ organizationId }: { organizationId: string }) =>
    db
      .select({
        ...topicColumns,
        articleCount: sql<number>`(
          select count(*)::int from ${schema.helpCenterArticleTable}
          where ${schema.helpCenterArticleTable.topicId} = ${schema.helpCenterTopicTable.id}
        )`,
      })
      .from(schema.helpCenterTopicTable)
      .where(eq(schema.helpCenterTopicTable.organizationId, organizationId))
      .orderBy(...displayOrder);

  /**
   * The portal's list: only topics that hold at least one published article.
   *
   * A topic whose every article is still a draft names unreleased
   * documentation, so publishing an empty section would disclose the draft
   * pipeline even though each article inside stays unpublished. Same rule as
   * `changelog-category`'s `findManyPublished`.
   */
  const findManyPublished = ({ organizationId }: { organizationId: string }) =>
    db
      .select({
        ...topicColumns,
        articleCount: sql<number>`(
          select count(*)::int from ${schema.helpCenterArticleTable}
          where ${schema.helpCenterArticleTable.topicId} = ${schema.helpCenterTopicTable.id}
            and ${schema.helpCenterArticleTable.status} = 'published'
        )`,
      })
      .from(schema.helpCenterTopicTable)
      .where(
        and(
          eq(schema.helpCenterTopicTable.organizationId, organizationId),
          sql`exists (
            select 1 from ${schema.helpCenterArticleTable}
            where ${schema.helpCenterArticleTable.topicId} = ${schema.helpCenterTopicTable.id}
              and ${schema.helpCenterArticleTable.status} = 'published'
          )`
        )
      )
      .orderBy(...displayOrder);

  const findBySlug = ({
    organizationId,
    slug,
  }: {
    organizationId: string;
    slug: string;
  }) =>
    db
      .select(topicColumns)
      .from(schema.helpCenterTopicTable)
      .where(
        and(
          eq(schema.helpCenterTopicTable.organizationId, organizationId),
          eq(schema.helpCenterTopicTable.slug, slug)
        )
      )
      .limit(1)
      .pipe(Effect.map((rows) => rows[0]));

  const countByOrganizationId = ({
    organizationId,
  }: {
    organizationId: string;
  }) =>
    db
      .select({ count: count() })
      .from(schema.helpCenterTopicTable)
      .where(eq(schema.helpCenterTopicTable.organizationId, organizationId))
      .pipe(Effect.map((rows) => rows[0]?.count ?? 0));

  /** Articles under each named topic, for the delete guard's message. */
  const countArticlesByTopic = ({
    organizationId,
    topicId,
  }: {
    organizationId: string;
    topicId: string;
  }) =>
    db
      .select({ count: count() })
      .from(schema.helpCenterArticleTable)
      .where(
        and(
          eq(schema.helpCenterArticleTable.organizationId, organizationId),
          eq(schema.helpCenterArticleTable.topicId, topicId)
        )
      )
      .pipe(Effect.map((rows) => rows[0]?.count ?? 0));

  const create = ({
    id,
    organizationId,
    name,
    slug,
    description,
    icon,
    position,
  }: TCreateTopic) =>
    Effect.gen(function* () {
      const now = yield* DateTime.nowAsDate;
      yield* db
        .insert(schema.helpCenterTopicTable)
        .values({
          id,
          organizationId,
          name,
          slug,
          description,
          icon,
          position,
          createdAt: now,
          updatedAt: now,
        })
        .pipe(Effect.asVoid);
    });

  const update = ({
    id,
    organizationId,
    name,
    slug,
    description,
    icon,
  }: TUpdateTopic) =>
    Effect.gen(function* () {
      const now = yield* DateTime.nowAsDate;
      yield* db
        .update(schema.helpCenterTopicTable)
        .set({ name, slug, description, icon, updatedAt: now })
        .where(
          and(
            eq(schema.helpCenterTopicTable.id, id),
            eq(schema.helpCenterTopicTable.organizationId, organizationId)
          )
        )
        .pipe(Effect.asVoid);
    });

  const remove = ({ id, organizationId }: THelpCenterTopicDelete) =>
    db
      .delete(schema.helpCenterTopicTable)
      .where(
        and(
          eq(schema.helpCenterTopicTable.id, id),
          eq(schema.helpCenterTopicTable.organizationId, organizationId)
        )
      )
      .pipe(Effect.asVoid);

  /**
   * Apply a complete order in one transaction.
   *
   * `topicIds` that does not name the workspace's whole set is refused by the
   * handler rather than silently reordered here: a partial list applied as
   * "these first" would leave the untouched topics at positions that now
   * collide with the new ones.
   */
  const setOrder = ({ organizationId, topicIds }: THelpCenterTopicReorder) =>
    Effect.gen(function* () {
      if (topicIds.length === 0) {
        return;
      }

      const now = yield* DateTime.nowAsDate;
      yield* db.transaction((tx) =>
        Effect.forEach(
          topicIds,
          (id, index) =>
            tx
              .update(schema.helpCenterTopicTable)
              .set({ position: index, updatedAt: now })
              .where(
                and(
                  eq(schema.helpCenterTopicTable.id, id),
                  eq(schema.helpCenterTopicTable.organizationId, organizationId)
                )
              ),
          { discard: true }
        )
      );
    });

  /** The ids the workspace actually owns, so a reorder can be validated. */
  const findIds = ({
    organizationId,
    topicIds,
  }: {
    organizationId: string;
    topicIds: readonly string[];
  }) =>
    topicIds.length === 0
      ? Effect.succeed([])
      : db
          .select({ id: schema.helpCenterTopicTable.id })
          .from(schema.helpCenterTopicTable)
          .where(
            and(
              eq(schema.helpCenterTopicTable.organizationId, organizationId),
              inArray(schema.helpCenterTopicTable.id, [...topicIds])
            )
          )
          .pipe(Effect.map((rows) => rows.map((row) => row.id)));

  /** Next free position, so a create appends instead of colliding at 0. */
  const nextPosition = ({ organizationId }: { organizationId: string }) =>
    db
      .select({
        next: sql<number>`coalesce(max(${schema.helpCenterTopicTable.position}), -1) + 1`,
      })
      .from(schema.helpCenterTopicTable)
      .where(eq(schema.helpCenterTopicTable.organizationId, organizationId))
      .pipe(Effect.map((rows) => rows[0]?.next ?? 0));

  return {
    findMany,
    findManyPublished,
    findBySlug,
    countByOrganizationId,
    countArticlesByTopic,
    findIds,
    nextPosition,
    create,
    update,
    remove,
    setOrder,
  };
});

export class HelpCenterTopicRepository extends Context.Service<HelpCenterTopicRepository>()(
  "HelpCenterTopicRepository",
  {
    make: makeHelpCenterTopicRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
