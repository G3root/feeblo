import { currentDb, schema } from "@feeblo/db";
import { PostTagId, TagId } from "@feeblo/id";
import { slugify } from "@feeblo/utils/url";
import { and, asc, desc, eq, exists, inArray, ne, or, sql } from "drizzle-orm";
import * as EffectArray from "effect/Array";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { PolicyDeniedError } from "../policy";
import { FailedToCreateTagError } from "./errors";
import type { TPostTagList } from "./schema";

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

/**
 * The assignment input, typed with plain identifiers rather than the RPC
 * payload schema's branded ones: the dashboard decodes a branded id before it
 * reaches the repository, while the Public API's key is scoped to one
 * workspace and its ids come from the database, so it passes strings.
 */
interface TPostTagSetInput {
  organizationId: string;
  postId: string;
  tagIds: readonly string[];
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

    /**
     * Deletes a tag, reporting whether there was one to delete.
     *
     * Deleting a tag also removes it from every post that carried it, through
     * the `post_tag` cascade — and that changes those posts' `tags` payload,
     * so their `updatedAt` moves with it in the same transaction. A caller
     * syncing on `updatedAt` therefore sees a post whose tags were deleted
     * rather than a stale list. The affected posts are read before the cascade
     * removes the rows that name them, under a lock on the tag row: a
     * concurrent replacement's foreign-key check takes a `key share` lock on
     * that row, so it either commits before this read (and is included) or
     * waits here and finds the tag gone.
     *
     * The timestamp moves forward only: `greatest` against the row's current
     * value, because this update takes each post's row lock when the statement
     * runs, and a writer holding that lock may commit a later `updatedAt` than
     * the instant sampled here — one already-synced by a caller, which this
     * write must not rewind. The tag assignment path does not need it: it
     * locks the post before sampling, so its sample is necessarily the later
     * one.
     */
    delete: ({ id, organizationId }: TTagDelete) =>
      db.transaction((tx) =>
        Effect.gen(function* () {
          const tag = yield* tx
            .select({ id: schema.tagTable.id })
            .from(schema.tagTable)
            .where(
              and(
                eq(schema.tagTable.id, id),
                eq(schema.tagTable.organizationId, organizationId)
              )
            )
            .for("update")
            .limit(1);

          // Missing rather than deleted: reported the same way the bare
          // delete reported an empty `returning`.
          if (tag.length === 0) {
            return false;
          }

          const affected = yield* tx
            .select({ postId: schema.postTagTable.postId })
            .from(schema.postTagTable)
            .where(
              and(
                eq(schema.postTagTable.tagId, id),
                eq(schema.postTagTable.organizationId, organizationId)
              )
            );

          const deleted = yield* tx
            .delete(schema.tagTable)
            .where(
              and(
                eq(schema.tagTable.id, id),
                eq(schema.tagTable.organizationId, organizationId)
              )
            )
            .returning({ id: schema.tagTable.id });

          if (deleted.length === 0) {
            return false;
          }

          if (affected.length > 0) {
            const now = yield* DateTime.nowAsDate;
            yield* tx
              .update(schema.postTable)
              .set({
                // Never earlier than what the row already carries: this
                // statement may wait on a row another writer holds, and the
                // writer's committed timestamp can be later than `now` here.
                updatedAt: sql`greatest(${schema.postTable.updatedAt}, ${now})`,
              })
              .where(
                and(
                  eq(schema.postTable.organizationId, organizationId),
                  inArray(
                    schema.postTable.id,
                    affected.map((row) => row.postId)
                  )
                )
              )
              .pipe(Effect.asVoid);
          }

          return true;
        })
      ),

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

    setPostTags: ({ postId, organizationId, tagIds }: TPostTagSetInput) =>
      Effect.gen(function* () {
        // Deduplicated here rather than by the caller: the diff below compares
        // sets, so the same id twice would otherwise look like two additions.
        const wanted = [...new Set(tagIds)];

        const post = yield* db
          .select({ id: schema.postTable.id })
          .from(schema.postTable)
          .where(
            and(
              eq(schema.postTable.id, postId),
              eq(schema.postTable.organizationId, organizationId)
            )
          )
          .for("no key update");

        if (post.length === 0) {
          return yield* new PolicyDeniedError({
            reason: "Post does not belong to this organization",
          });
        }

        // Sampled inside the post's lock, not before it: a concurrent
        // replacement waits on this row, so its sample is necessarily later
        // than this one's and `updatedAt` cannot move backwards on a
        // contended post. A sample taken while waiting could be older than the
        // write that released the lock.
        const now = yield* DateTime.nowAsDate;

        const previous = yield* db
          .select({ tagId: schema.postTagTable.tagId })
          .from(schema.postTagTable)
          .where(
            and(
              eq(schema.postTagTable.postId, postId),
              eq(schema.postTagTable.organizationId, organizationId)
            )
          );
        const previousTagIds = previous.map((row) => row.tagId);
        const previousSet = new Set(previousTagIds);
        const nextSet = new Set(wanted);

        const removed = previousTagIds.filter((tagId) => !nextSet.has(tagId));
        if (removed.length > 0) {
          yield* db
            .delete(schema.postTagTable)
            .where(
              and(
                eq(schema.postTagTable.postId, postId),
                eq(schema.postTagTable.organizationId, organizationId),
                inArray(schema.postTagTable.tagId, removed)
              )
            )
            .pipe(Effect.asVoid);
        }

        const added = wanted.filter((tagId) => !previousSet.has(tagId));
        if (added.length > 0) {
          const rows = yield* Effect.forEach(added, (tagId) =>
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

          // `post_tag_postId_tagId_uidx` would abort the transaction if a
          // concurrent request inserted the same tag first; the ids are
          // deduplicated above, so this is the backstop rather than the rule.
          yield* db
            .insert(schema.postTagTable)
            .values(rows)
            .onConflictDoNothing()
            .pipe(Effect.asVoid);
        }

        // A post's tags are part of the post, so a replacement that changed
        // them is a change to the post: `post.updatedAt` moves, and a caller
        // filtering on it — the Public API's `updatedAfter` — sees the post
        // rather than a stale tag list. A replacement that named the set the
        // post already carried changes nothing and does not bump, matching the
        // shared write path's rule that storing the same values is not an
        // update. The row is already locked for the comparison above, so this
        // update cannot race a concurrent replacement.
        if (removed.length > 0 || added.length > 0) {
          yield* db
            .update(schema.postTable)
            .set({ updatedAt: now })
            .where(
              and(
                eq(schema.postTable.id, postId),
                eq(schema.postTable.organizationId, organizationId)
              )
            )
            .pipe(Effect.asVoid);
        }

        const tags = yield* db
          .select({ id: schema.tagTable.id, name: schema.tagTable.name })
          .from(schema.postTagTable)
          .innerJoin(
            schema.tagTable,
            eq(schema.tagTable.id, schema.postTagTable.tagId)
          )
          .where(
            and(
              eq(schema.postTagTable.postId, postId),
              eq(schema.postTagTable.organizationId, organizationId)
            )
          )
          .orderBy(asc(schema.tagTable.name));

        return { previousTagIds, tags };
      }),

    /**
     * How many of the given tag ids exist in the workspace.
     *
     * `lock: "key share"` takes the lock the foreign-key check itself takes:
     * a tag deleted concurrently either loses the race and is missing from
     * this read, or waits here until the rows that reference it exist and then
     * cascades them away with it. The Public API's replacement asks for it
     * inside its transaction; the dashboard's pre-check does not need it.
     */
    countExistingTags: ({
      organizationId,
      tagIds,
      lock,
    }: TCountExistingTags & { readonly lock?: "key share" }) =>
      tagIds.length === 0
        ? Effect.succeed(0)
        : Effect.gen(function* () {
            const query = db
              .select({ id: schema.tagTable.id })
              .from(schema.tagTable)
              .where(
                and(
                  eq(schema.tagTable.organizationId, organizationId),
                  inArray(schema.tagTable.id, tagIds)
                )
              );
            const rows = yield* lock === undefined ? query : query.for(lock);
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

/**
 * Reads the repository from the fiber context.
 *
 * `HttpApiBuilder` does not thread a handler's service requirements through the
 * route layer, so the Public API's operations take it from the context the
 * composition provides — the same shape as `currentCommentService`.
 */
export const currentTagRepository = Effect.context<never>().pipe(
  Effect.map((context) => Context.getUnsafe(context, TagRepository))
);
