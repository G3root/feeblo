import { currentDb, schema } from "@feeblo/db";
import { PostTagId } from "@feeblo/id";
import { and, asc, eq, inArray } from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { PostActivityRepository } from "../../post-activity/repository";
import type { Cursor } from "../../public-api/cursor";
import {
  conflictError,
  internalError,
  invalidRequestError,
  notFoundError,
} from "../../public-api/errors";
import { withRemapDbErrors } from "../../rpc-errors";
import { postTagChangeActivities } from "../post-tag-activities";
import { TagRepository } from "../repository";

/** A tag reference: identity and label, and nothing else. */
export type PublicApiPostTag = {
  readonly id: string;
  readonly name: string;
};

/**
 * What a tag mapper is allowed to read.
 *
 * Declared structurally and narrowly on purpose: a mapper cannot accept the
 * dashboard row (which carries `creatorId`, `creatorMemberId`, and the
 * workspace) and pass it through, and a column added to the `tag` table cannot
 * reach a public response without being added here first.
 */
export type PublicApiTagSource = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type PublicApiTagPage = {
  readonly tags: readonly PublicApiTagSource[];
  readonly nextCursor: Cursor | null;
};

const toTagSource = (row: {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}): PublicApiTagSource => ({
  createdAt: row.createdAt,
  id: row.id,
  name: row.name,
  slug: row.slug,
  updatedAt: row.updatedAt,
});

/** The one message for both the pre-check and the index race that beats it. */
const TAG_NAME_CONFLICT = "A tag with this name already exists.";

/**
 * Tag storage as the Public API alone reads it.
 *
 * The writes and the lookup rules are the domain repository's own — the same
 * `TagRepository.create`/`update`/`delete`/`findNameConflict` the dashboard
 * RPCs call — and this service adds only the parts that are public-specific:
 * cursor-shaped paging, the published error vocabulary, and the tag-assignment
 * transaction that records the change on the post's timeline with no member as
 * its actor.
 */
const makePublicApiTagRepository = Effect.gen(function* () {
  const db = yield* currentDb;
  const tags = yield* TagRepository;
  const activities = yield* PostActivityRepository;

  return {
    /**
     * One page of the workspace's tags, newest first.
     *
     * The page tuple and ordering are the repository's; this slices the
     * `limit + 1` rows it selects and reports the cursor the next request
     * carries.
     */
    list: ({
      cursor,
      limit,
      organizationId,
    }: {
      cursor: Cursor | null;
      limit: number;
      organizationId: string;
    }) =>
      tags.findPage({ after: cursor, limit, organizationId }).pipe(
        Effect.map((rows) => {
          const hasMore = rows.length > limit;
          const pageRows = hasMore ? rows.slice(0, limit) : rows;
          const lastRow = pageRows.at(-1);

          return {
            nextCursor:
              hasMore && lastRow !== undefined
                ? { createdAt: lastRow.createdAt, id: lastRow.id }
                : null,
            tags: pageRows.map(toTagSource),
          } satisfies PublicApiTagPage;
        }),
        withRemapDbErrors("PublicApiTag", "select")
      ),

    /** One tag of the calling workspace, or nothing. */
    find: ({
      organizationId,
      tagId,
    }: {
      organizationId: string;
      tagId: string;
    }) =>
      tags
        .findById({ id: tagId, organizationId })
        .pipe(
          Effect.map(Option.map(toTagSource)),
          withRemapDbErrors("PublicApiTag", "select")
        ),

    /** The tag that already holds this name or slug, if any. */
    findNameConflict: (args: {
      excludeTagId: string | null;
      name: string;
      organizationId: string;
    }) =>
      tags
        .findNameConflict(args)
        .pipe(withRemapDbErrors("PublicApiTag", "select")),

    /**
     * Creates a tag and returns the row the database stored.
     *
     * The unique violation is mapped as well as pre-checked, because two
     * concurrent creates of the same name both pass the check and one of them
     * then loses the race at the index.
     */
    create: ({
      name,
      organizationId,
    }: {
      name: string;
      organizationId: string;
    }) =>
      tags.create({ name, organizationId }).pipe(
        // An insert either stores a row or fails; the domain reports the
        // broken invariant as its own failure, which is not a caller-actionable
        // state and is published as `INTERNAL_ERROR`.
        Effect.catchTag("FailedToCreateTagError", () =>
          Effect.fail(internalError())
        ),
        Effect.map(toTagSource),
        withRemapDbErrors({
          action: "create",
          entity: "PublicApiTag",
          onUniqueViolation: () => conflictError(TAG_NAME_CONFLICT),
        })
      ),

    /**
     * Renames a tag and returns the row the database stored.
     *
     * `None` means the row was deleted between the handler's read and this
     * write; the operation answers that on the published `NOT_FOUND`.
     */
    update: ({
      name,
      organizationId,
      tagId,
    }: {
      name: string;
      organizationId: string;
      tagId: string;
    }) =>
      tags.update({ id: tagId, name, organizationId }).pipe(
        Effect.map(Option.map(toTagSource)),
        withRemapDbErrors({
          action: "update",
          entity: "PublicApiTag",
          onUniqueViolation: () => conflictError(TAG_NAME_CONFLICT),
        })
      ),

    /**
     * Deletes a tag and its post assignments.
     *
     * `post_tag.tag_id` cascades, so a deleted tag stops labelling every post
     * it was on — the same behaviour as deleting it in the dashboard. Reports
     * whether there was a row to delete, so a delete raced by another delete is
     * answered as the missing tag it is.
     */
    delete: ({
      organizationId,
      tagId,
    }: {
      organizationId: string;
      tagId: string;
    }) =>
      tags
        .delete({ id: tagId, organizationId })
        .pipe(withRemapDbErrors("PublicApiTag", "delete")),

    /**
     * Replaces a post's tags and returns the tags it carries afterwards.
     *
     * A replacement rather than add and remove calls, so a caller that states
     * the final set cannot leave a tag behind by forgetting to remove it. The
     * post is locked first, then the check, the write, the timeline entries,
     * and the read-back all run in that one transaction: two replacements of
     * the same post cannot interleave into a set neither caller asked for, a
     * tag or post that disappears mid-request is answered as the missing
     * resource it is rather than as a foreign-key failure, the response is
     * exactly what a later read returns, and a post cannot end up tagged with
     * no record of the change in its history.
     *
     * Only the rows that actually change are written. `post_tag` carries
     * `merged_from_post_id` on the rows a merge moved onto this post, and the
     * unmerge path restores exactly those rows to their source; deleting and
     * re-inserting an unchanged tag would clear that provenance and strand the
     * tag on the survivor for good.
     *
     * The recorded actor is null because a machine key is not a member. The
     * `post_activity` columns allow that and the dashboard renders those
     * entries as "Someone" — which is true, and better than a post whose tags
     * change with no entry in its history at all.
     */
    setPostTags: ({
      organizationId,
      postId,
      tagIds,
    }: {
      organizationId: string;
      postId: string;
      tagIds: readonly string[];
    }) =>
      db
        .transaction((tx) =>
          Effect.gen(function* () {
            const now = yield* DateTime.nowAsDate;
            // Deduplicated here rather than by the caller: the check below
            // compares distinct rows, so the same id twice would otherwise look
            // like a tag the workspace does not have.
            const wanted = [...new Set(tagIds)];

            // The post is read before anything else, and locked. Without the
            // lock, two replacements of one post both read the same previous
            // set and each inserts only its own additions, leaving the post
            // with a union of the two requests — `[A, B]` and `[A, C]` would
            // end as `[A, B, C]`. The lock makes the second wait here, and the
            // reads below then happen in a snapshot that includes the first
            // one's rows, so the last writer's set is the set that survives.
            //
            // `no key update` rather than `update`: this row is pointed at by
            // foreign keys across the workspace, and the stronger lock would
            // block unrelated inserts that merely reference this post.
            const post = yield* tx
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
              return yield* notFoundError("Post not found.");
            }

            if (wanted.length > 0) {
              // `for("key share")` is the lock the foreign-key check itself
              // takes: a tag deleted concurrently either loses the race and is
              // missing from this read, or waits here until these rows exist
              // and then cascades them away with it.
              const known = yield* tx
                .select({ id: schema.tagTable.id })
                .from(schema.tagTable)
                .where(
                  and(
                    eq(schema.tagTable.organizationId, organizationId),
                    inArray(schema.tagTable.id, wanted)
                  )
                )
                .for("key share");

              if (known.length !== wanted.length) {
                return yield* invalidRequestError(
                  "One or more tagIds do not exist in this workspace."
                );
              }
            }

            const previous = yield* tx
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

            const removed = previousTagIds.filter(
              (tagId) => !nextSet.has(tagId)
            );
            if (removed.length > 0) {
              yield* tx
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
              // deduplicated above, so this is the backstop rather than the
              // rule.
              yield* tx
                .insert(schema.postTagTable)
                .values(rows)
                .onConflictDoNothing()
                .pipe(Effect.asVoid);
            }

            // The activity repository holds its own database handle, and
            // `withTransaction` keeps the connection in fiber-local context,
            // so these rows are written in the same transaction as the tags
            // above rather than in a second one that could fail alone.
            yield* activities.createMany(
              postTagChangeActivities({
                previousTagIds,
                nextTagIds: wanted,
                actor: {
                  actorId: null,
                  actorMemberId: null,
                  organizationId,
                  postId,
                },
              })
            );

            const tags = yield* tx
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

            return tags satisfies readonly PublicApiPostTag[];
          })
        )
        .pipe(withRemapDbErrors("PublicApiTag", "update")),
  };
});

export class PublicApiTagRepository extends Context.Service<PublicApiTagRepository>()(
  "PublicApiTagRepository",
  {
    make: makePublicApiTagRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}

/**
 * Reads the repository from the fiber context.
 *
 * `HttpApiBuilder` does not thread a handler's service requirements through the
 * route layer, so handlers take services from the context the composition
 * provides — the same shape as `currentPublicApiCaller`.
 */
export const currentPublicApiTagRepository = Effect.context<never>().pipe(
  Effect.map((context) => Context.getUnsafe(context, PublicApiTagRepository))
);
