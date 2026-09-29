import { currentDb, schema } from "@feeblo/db";
import { PostTagId, TagId } from "@feeblo/id";
import { slugify } from "@feeblo/utils/url";
import { and, desc, eq, exists, inArray, ne, or, sql } from "drizzle-orm";
import * as EffectArray from "effect/Array";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { FailedToCreateTagError } from "./errors";
import type { TPostTagList, TPostTagSet } from "./schema";

/**
 * The fields a tag read selects, and the only place a tag field is named.
 *
 * Shared by the dashboard's lists and the Public API's paged reads so the two
 * cannot disagree about what a tag is made of; the public response mapper
 * narrows this to the published field set.
 */
const TAG_FIELDS = {
  id: schema.tagTable.id,
  name: schema.tagTable.name,
  slug: schema.tagTable.slug,
  organizationId: schema.tagTable.organizationId,
  createdAt: schema.tagTable.createdAt,
  updatedAt: schema.tagTable.updatedAt,
} as const;

interface TTagCreate {
  /**
   * Omitted by the Public API, whose key is not a member acting on records it
   * can already see; a dashboard caller mints one client-side.
   */
  id?: string;
  name: string;
  organizationId: string;
  /** Omitted when the writer is a machine key rather than a member. */
  creatorId?: string;
  creatorMemberId?: string;
}

interface TTagUpdate {
  id: string;
  name: string;
  organizationId: string;
}

interface TTagDelete {
  id: string;
  organizationId: string;
}

interface TFindTagPage {
  after: { readonly createdAt: Date; readonly id: string } | null;
  limit: number;
  organizationId: string;
}

interface TFindTagNameConflict {
  /** The tag being renamed, excluded from its own conflict check. */
  excludeTagId: string | null;
  name: string;
  organizationId: string;
}

interface TFindManyTags {
  organizationId: string;
}

interface TFindManyPublicTags extends TFindManyTags {
  includeFeedback: boolean;
}

interface TCountExistingTags {
  organizationId: string;
  tagIds: readonly string[];
}

interface THasPost {
  organizationId: string;
  postId: string;
}

interface TFindTagById {
  id: string;
  organizationId: string;
}

const makeTagRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  return {
    findMany: ({ organizationId }: TFindManyTags) =>
      db
        .select({
          id: schema.tagTable.id,
          name: schema.tagTable.name,
          slug: schema.tagTable.slug,
          organizationId: schema.tagTable.organizationId,
          createdAt: schema.tagTable.createdAt,
          updatedAt: schema.tagTable.updatedAt,
        })
        .from(schema.tagTable)
        .where(eq(schema.tagTable.organizationId, organizationId)),

    findManyPublic: ({
      organizationId,
      includeFeedback,
    }: TFindManyPublicTags) => {
      if (!includeFeedback) {
        return Effect.succeed([]);
      }

      return db
        .select({
          id: schema.tagTable.id,
          name: schema.tagTable.name,
          slug: schema.tagTable.slug,
          organizationId: schema.tagTable.organizationId,
          createdAt: schema.tagTable.createdAt,
          updatedAt: schema.tagTable.updatedAt,
        })
        .from(schema.tagTable)
        .where(
          and(
            eq(schema.tagTable.organizationId, organizationId),
            exists(
              db
                .select({ id: schema.postTagTable.id })
                .from(schema.postTagTable)
                .innerJoin(
                  schema.postTable,
                  eq(schema.postTable.id, schema.postTagTable.postId)
                )
                .innerJoin(
                  schema.boardTable,
                  eq(schema.boardTable.id, schema.postTable.boardId)
                )
                .where(
                  and(
                    eq(schema.postTagTable.tagId, schema.tagTable.id),
                    eq(schema.boardTable.visibility, "PUBLIC")
                  )
                )
            )
          )
        );
    },

    /**
     * Creates a tag and returns the stored row.
     *
     * The id is optional so the Public API can have the server mint it; a
     * dashboard caller still supplies one, and the insert is otherwise
     * identical, so the slug rule lives here rather than in either caller.
     */
    create: ({
      id,
      name,
      organizationId,
      creatorId,
      creatorMemberId,
    }: TTagCreate) =>
      Effect.gen(function* () {
        const tagId = id ?? (yield* TagId.generate);
        const now = yield* DateTime.nowAsDate;
        const [created] = yield* db
          .insert(schema.tagTable)
          .values({
            id: tagId,
            name,
            slug: slugify(name),
            organizationId,
            ...(creatorId !== undefined && { creatorId }),
            ...(creatorMemberId !== undefined && { creatorMemberId }),
            createdAt: now,
            updatedAt: now,
          })
          .returning(TAG_FIELDS);

        // An insert either stores a row or fails; an empty `returning` is a
        // broken invariant, not something the caller did.
        if (created === undefined) {
          return yield* new FailedToCreateTagError();
        }

        return created;
      }),

    update: ({ id, name, organizationId }: TTagUpdate) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        const [updated] = yield* db
          .update(schema.tagTable)
          .set({
            name,
            slug: slugify(name),
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.tagTable.id, id),
              eq(schema.tagTable.organizationId, organizationId)
            )
          )
          .returning(TAG_FIELDS);

        // `None` rather than a failure: a caller that read the tag first is
        // owed the "not found" it documented, not a server fault for a race.
        return Option.fromNullishOr(updated);
      }),

    /** Deletes a tag, reporting whether there was one to delete. */
    delete: ({ id, organizationId }: TTagDelete) =>
      db
        .delete(schema.tagTable)
        .where(
          and(
            eq(schema.tagTable.id, id),
            eq(schema.tagTable.organizationId, organizationId)
          )
        )
        .returning({ id: schema.tagTable.id })
        .pipe(Effect.map((rows) => rows.length > 0)),

    /**
     * The tag that already holds this name or slug, if any.
     *
     * Takes the name rather than a slug so that the slug rule lives in exactly
     * one place: a pre-check that derived the slug differently from the insert
     * would let a caller through to an index violation it could not explain.
     * Both indexes are checked together because they are two spellings of the
     * same collision — `UI Kit` and `ui-kit` slugify alike — and a caller told
     * only about the name would retry and hit the other index instead.
     */
    findNameConflict: ({
      excludeTagId,
      name,
      organizationId,
    }: TFindTagNameConflict) =>
      db
        .select({ id: schema.tagTable.id })
        .from(schema.tagTable)
        .where(
          and(
            eq(schema.tagTable.organizationId, organizationId),
            or(
              eq(schema.tagTable.name, name),
              eq(schema.tagTable.slug, slugify(name))
            ),
            ...(excludeTagId === null
              ? []
              : [ne(schema.tagTable.id, excludeTagId)])
          )
        )
        .limit(1)
        .pipe(Effect.map(EffectArray.get(0))),

    /**
     * One page of the workspace's tags, newest first.
     *
     * The page tuple is `(createdAt, id)` so a cursor names a row rather than
     * an offset, and the caller passes it back through `after`; the ordering
     * and the tuple live here so the dashboard list and the Public API page
     * cannot page differently. Selects one more row than asked for so the
     * caller learns whether another page exists without a second query.
     */
    findPage: ({ after, limit, organizationId }: TFindTagPage) => {
      const conditions = [
        eq(schema.tagTable.organizationId, organizationId),
        ...(after === null
          ? []
          : [
              sql`(${schema.tagTable.createdAt}, ${schema.tagTable.id}) < (${after.createdAt}, ${after.id})`,
            ]),
      ];

      return db
        .select(TAG_FIELDS)
        .from(schema.tagTable)
        .where(and(...conditions))
        .orderBy(desc(schema.tagTable.createdAt), desc(schema.tagTable.id))
        .limit(limit + 1);
    },

    findPostTags: (
      { organizationId, slug }: TPostTagList,
      options?: { publicOnly?: boolean }
    ) =>
      db
        .select({
          id: schema.postTagTable.id,
          postId: schema.postTagTable.postId,
          tagId: schema.postTagTable.tagId,
          organizationId: schema.postTagTable.organizationId,
          createdAt: schema.postTagTable.createdAt,
          updatedAt: schema.postTagTable.updatedAt,
        })
        .from(schema.postTagTable)
        .innerJoin(
          schema.postTable,
          eq(schema.postTable.id, schema.postTagTable.postId)
        )
        .innerJoin(
          schema.boardTable,
          eq(schema.boardTable.id, schema.postTable.boardId)
        )
        .where(
          and(
            eq(schema.postTagTable.organizationId, organizationId),
            ...(slug ? [eq(schema.postTable.slug, slug)] : []),
            ...(options?.publicOnly
              ? [eq(schema.boardTable.visibility, "PUBLIC")]
              : [])
          )
        ),

    findPostTagIds: ({
      organizationId,
      postId,
    }: {
      organizationId: string;
      postId: string;
    }) =>
      db
        .select({ tagId: schema.postTagTable.tagId })
        .from(schema.postTagTable)
        .where(
          and(
            eq(schema.postTagTable.postId, postId),
            eq(schema.postTagTable.organizationId, organizationId)
          )
        )
        .pipe(Effect.map((rows) => rows.map((row) => row.tagId))),

    setPostTags: ({ postId, organizationId, tagIds }: TPostTagSet) =>
      db
        .transaction((tx) =>
          Effect.gen(function* () {
            const now = yield* DateTime.nowAsDate;
            yield* tx
              .delete(schema.postTagTable)
              .where(
                and(
                  eq(schema.postTagTable.postId, postId),
                  eq(schema.postTagTable.organizationId, organizationId)
                )
              );

            if (tagIds.length === 0) {
              return;
            }

            const rows = yield* Effect.forEach(tagIds, (tagId) =>
              PostTagId.generate.pipe(
                Effect.map((id) => ({
                  id,
                  postId,
                  tagId,
                  organizationId,
                  createdAt: now,
                  updatedAt: now,
                }))
              )
            );

            yield* tx
              .insert(schema.postTagTable)
              .values(rows)
              .onConflictDoNothing();
          })
        )
        .pipe(Effect.asVoid),

    countExistingTags: ({ organizationId, tagIds }: TCountExistingTags) =>
      tagIds.length === 0
        ? Effect.succeed(0)
        : Effect.gen(function* () {
            const rows = yield* db
              .select({ id: schema.tagTable.id })
              .from(schema.tagTable)
              .where(
                and(
                  eq(schema.tagTable.organizationId, organizationId),
                  inArray(schema.tagTable.id, tagIds)
                )
              );
            return rows.length;
          }),

    hasPost: ({ postId, organizationId }: THasPost) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ id: schema.postTable.id })
          .from(schema.postTable)
          .where(
            and(
              eq(schema.postTable.id, postId),
              eq(schema.postTable.organizationId, organizationId)
            )
          );
        return rows.length > 0;
      }),

    hasPostCreator: ({
      postId,
      organizationId,
      userId,
    }: THasPost & { userId: string }) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ id: schema.postTable.id })
          .from(schema.postTable)
          .where(
            and(
              eq(schema.postTable.id, postId),
              eq(schema.postTable.organizationId, organizationId),
              eq(schema.postTable.creatorId, userId)
            )
          );
        return rows.length > 0;
      }),

    /** One tag of the calling workspace, or nothing. */
    findById: ({ id, organizationId }: TFindTagById) =>
      db
        .select(TAG_FIELDS)
        .from(schema.tagTable)
        .where(
          and(
            eq(schema.tagTable.id, id),
            eq(schema.tagTable.organizationId, organizationId)
          )
        )
        .limit(1)
        .pipe(Effect.map(EffectArray.get(0))),
  };
});

export class TagRepository extends Context.Service<TagRepository>()(
  "TagRepository",
  {
    make: makeTagRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
