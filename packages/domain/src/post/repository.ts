import { currentDb, schema } from "@feeblo/db";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { isString } from "@feeblo/utils/runtime-kind";
import { slugify } from "@feeblo/utils/url";
import {
  and,
  asc,
  cosineDistance,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  notExists,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import * as EffectArray from "effect/Array";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { getUniqueViolationConstraint, isUniqueViolation } from "../rpc-errors";
import { FailedToMergePostError, PostAlreadyExistsError } from "./errors";
import type { TPostAdminUpdate } from "./schema";

interface TPostUpdateInput {
  boardId?: string;
  content?: string;
  etaQuarter?: string | null | undefined;
  excerpt?: string;
  id: string;
  organizationId: string;
  statusId?: string;
  title?: string;
}

interface TPostFindMany {
  boardId?: string | null | undefined;
  organizationId: string;
}

interface TPostFindDeletableIds {
  organizationId: string;
  userId: string;
}

interface TPostFindPublicBySlug {
  organizationId: string;
  slug: string;
}

interface TPostDelete {
  boardId: string;
  creatorId: string;
  id: string | readonly string[];
  onlyIfNew: boolean;
  organizationId: string;
}

interface TPostCreate {
  boardId: string;
  contactId?: string | null;
  content: string;
  creatorId?: string | null;
  creatorMemberId?: string | null;
  etaQuarter?: string | null | undefined;
  excerpt?: string;
  id: string;
  metadata?: Record<string, string>;
  organizationId: string;
  source?:
    | "DASHBOARD"
    | "WIDGET"
    | "API"
    | "IMPORT"
    | "PUBLIC_BOARD"
    | "SLACK"
    | "DISCORD";
  statusId: string;
  title: string;
}

interface TPostMerge {
  organizationId: string;
  sourcePostId: string;
  targetPostId: string;
}

interface TPostFindByCreatorId {
  boardId: string;
  id: string;
  organizationId: string;
  userId: string;
}

interface TPostFindByCreatorIds {
  boardId: string;
  ids: readonly string[];
  organizationId: string;
  userId: string;
}

interface TPostFindNewByCreatorId extends TPostFindByCreatorId {}

interface TPostFindNewByCreatorIds extends TPostFindByCreatorIds {}

interface TPostById {
  id: string;
  organizationId: string;
}

interface TPostSuggestionCandidates {
  boardId?: string;
  embedding?: readonly number[];
  embeddingModel?: string;
  limit: number;
  organizationId: string;
  publicOnly: boolean;
}

const getWhereClause = (where: SQL[]) =>
  where.length > 1
    ? and(...where)
    : Option.match(EffectArray.get(0)(where), {
        onNone: () => undefined,
        onSome: (clause) => clause,
      });

/**
 * Contact columns backing the dashboard author-display fallback (see
 * `contactFallback` below). Public selects must never join the contact
 * table: contact names are workspace-internal and must not leak onto
 * public boards.
 */
const selectPostFields = (opts?: { contactFallback?: boolean }) => ({
  id: schema.postTable.id,
  title: schema.postTable.title,
  boardId: schema.postTable.boardId,
  slug: schema.postTable.slug,
  content: schema.postTable.content,
  excerpt: schema.postTable.excerpt,
  statusId: schema.postTable.statusId,
  etaQuarter: schema.postTable.etaQuarter,
  createdAt: schema.postTable.createdAt,
  updatedAt: schema.postTable.updatedAt,
  organizationId: schema.postTable.organizationId,
  user: {
    // Dashboard rows attribute contact-only authors (bare/new emails with
    // no user row, e.g. from on-behalf creation or PostUpdateAuthor) to
    // their contact name instead of rendering "Unknown author". The
    // fallback is dashboard-only: public selects keep the user join alone
    // so customer names never leak onto public boards.
    name: opts?.contactFallback
      ? sql<
          string | null
        >`COALESCE(${schema.userTable.name}, ${schema.contactTable.name})`
      : sql<string | null>`${schema.userTable.name}`,
    image: opts?.contactFallback
      ? sql<
          string | null
        >`COALESCE(${schema.userTable.image}, ${schema.contactTable.avatar})`
      : sql<string | null>`${schema.userTable.image}`,
  },
  creatorMemberId: schema.postTable.creatorMemberId,
  creatorId: schema.postTable.creatorId,
  metadata: schema.postTable.metadata,
  lockedAt: schema.postTable.lockedAt,
  archivedAt: schema.postTable.archivedAt,
  mergedIntoPostId: schema.postTable.mergedIntoPostId,
  mergedAt: schema.postTable.mergedAt,
});

const selectPostListFields = (opts?: { contactFallback?: boolean }) => {
  // Lists never render the full body (cards show `excerpt`; detail pages
  // resolve `content` through `PostGet`/`PostGetPublic`), so drop the
  // heaviest column while keeping every other list field identical.
  // `canDeleteAsCreator` is dropped too: its two per-row NOT EXISTS probes
  // ran on every list fetch for every row, yet only the session user's own
  // rows can ever be true. Delete affordances resolve it on demand through
  // `PostDeleteEligibility`/`PostDeleteEligibilityPublic` instead.
  const { content: _content, ...listFields } = selectPostFields(opts);
  return listFields;
};

const makePostRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  return {
    /**
     * Authenticated single-post fetch backing the `PostGet` RPC. Scoped to
     * the organization (membership is enforced by the handler's policy);
     * unlike `findPublicBySlug` it does not gate on board visibility, so
     * members can open posts on private boards and moderators can review
     * archived content.
     */
    findBySlug: ({ organizationId, slug }: TPostFindPublicBySlug) =>
      db
        .select(selectPostFields({ contactFallback: true }))
        .from(schema.postTable)
        .leftJoin(
          schema.userTable,
          eq(schema.userTable.id, schema.postTable.creatorId)
        )
        .leftJoin(
          schema.contactTable,
          eq(schema.contactTable.id, schema.postTable.contactId)
        )
        .where(
          and(
            eq(schema.postTable.organizationId, organizationId),
            eq(schema.postTable.slug, slug)
          )
        )
        .limit(1)
        .pipe(Effect.map((rows) => rows[0])),
    findActivityState: ({ id, organizationId }: TPostById) =>
      db
        .select({
          archivedAt: schema.postTable.archivedAt,
          boardId: schema.postTable.boardId,
          contactId: schema.postTable.contactId,
          content: schema.postTable.content,
          creatorId: schema.postTable.creatorId,
          creatorMemberId: schema.postTable.creatorMemberId,
          etaQuarter: schema.postTable.etaQuarter,
          lockedAt: schema.postTable.lockedAt,
          slug: schema.postTable.slug,
          statusId: schema.postTable.statusId,
          title: schema.postTable.title,
        })
        .from(schema.postTable)
        .where(
          and(
            eq(schema.postTable.id, id),
            eq(schema.postTable.organizationId, organizationId)
          )
        )
        .limit(1)
        .for("update")
        .pipe(Effect.map((rows) => rows[0])),

    findStatusId: ({ id, organizationId }: TPostById) =>
      db
        .select({ statusId: schema.postTable.statusId })
        .from(schema.postTable)
        .where(
          and(
            eq(schema.postTable.id, id),
            eq(schema.postTable.organizationId, organizationId)
          )
        )
        .limit(1)
        .pipe(Effect.map((rows) => rows[0]?.statusId)),

    /** Current board/status of a post, used to reject location changes on public paths. */
    findLocationIds: ({ id, organizationId }: TPostById) =>
      db
        .select({
          boardId: schema.postTable.boardId,
          statusId: schema.postTable.statusId,
        })
        .from(schema.postTable)
        .where(
          and(
            eq(schema.postTable.id, id),
            eq(schema.postTable.organizationId, organizationId)
          )
        )
        .limit(1)
        .pipe(Effect.map((rows) => rows[0])),

    findStatusType: ({
      id,
      organizationId,
    }: {
      readonly id: string;
      readonly organizationId: string;
    }) =>
      db
        .select({ type: schema.postStatusTable.type })
        .from(schema.postStatusTable)
        .where(
          and(
            eq(schema.postStatusTable.id, id),
            eq(schema.postStatusTable.organizationId, organizationId)
          )
        )
        .limit(1)
        .pipe(Effect.map((rows) => rows[0]?.type)),

    findByCreatorId: ({
      id,
      organizationId,
      userId,
      boardId,
    }: TPostFindByCreatorId) =>
      db
        .select({ id: schema.postTable.id })
        .from(schema.postTable)
        .where(
          and(
            eq(schema.postTable.id, id),
            eq(schema.postTable.organizationId, organizationId),
            eq(schema.postTable.creatorId, userId),
            eq(schema.postTable.boardId, boardId)
          )
        )
        .pipe(Effect.map(EffectArray.get(0))),

    findByCreatorIds: ({
      ids,
      organizationId,
      userId,
      boardId,
    }: TPostFindByCreatorIds) =>
      db
        .select({ id: schema.postTable.id })
        .from(schema.postTable)
        .where(
          and(
            inArray(schema.postTable.id, ids),
            eq(schema.postTable.organizationId, organizationId),
            eq(schema.postTable.creatorId, userId),
            eq(schema.postTable.boardId, boardId)
          )
        ),

    findNewByCreatorId: ({
      id,
      organizationId,
      userId,
      boardId,
    }: TPostFindNewByCreatorId) =>
      db
        .select({ id: schema.postTable.id })
        .from(schema.postTable)
        .where(
          and(
            eq(schema.postTable.id, id),
            eq(schema.postTable.organizationId, organizationId),
            eq(schema.postTable.creatorId, userId),
            eq(schema.postTable.boardId, boardId),
            notExists(
              db
                .select({ id: schema.commentTable.id })
                .from(schema.commentTable)
                .where(eq(schema.commentTable.postId, schema.postTable.id))
            ),
            notExists(
              db
                .select({ id: schema.upvoteTable.id })
                .from(schema.upvoteTable)
                .where(
                  and(
                    eq(schema.upvoteTable.postId, schema.postTable.id),
                    ne(schema.upvoteTable.userId, userId)
                  )
                )
            )
          )
        )
        .pipe(Effect.map(EffectArray.get(0))),

    findNewByCreatorIds: ({
      ids,
      organizationId,
      userId,
      boardId,
    }: TPostFindNewByCreatorIds) =>
      db
        .select({ id: schema.postTable.id })
        .from(schema.postTable)
        .where(
          and(
            inArray(schema.postTable.id, ids),
            eq(schema.postTable.organizationId, organizationId),
            eq(schema.postTable.creatorId, userId),
            eq(schema.postTable.boardId, boardId),
            notExists(
              db
                .select({ id: schema.commentTable.id })
                .from(schema.commentTable)
                .where(eq(schema.commentTable.postId, schema.postTable.id))
            ),
            notExists(
              db
                .select({ id: schema.upvoteTable.id })
                .from(schema.upvoteTable)
                .where(
                  and(
                    eq(schema.upvoteTable.postId, schema.postTable.id),
                    ne(schema.upvoteTable.userId, userId)
                  )
                )
            )
          )
        ),

    /**
     * Creator-side delete hints for the whole organization: posts the user
     * created that are still untouched (no comments, no foreign upvotes).
     * One set-based lookup, overfetched client-side; the delete path
     * re-validates per post with its board, so this stays a UI hint and
     * skips board scoping.
     */
    findDeletableIds: ({ organizationId, userId }: TPostFindDeletableIds) =>
      db
        .select({ id: schema.postTable.id })
        .from(schema.postTable)
        .where(
          and(
            eq(schema.postTable.organizationId, organizationId),
            eq(schema.postTable.creatorId, userId),
            notExists(
              db
                .select({ id: schema.commentTable.id })
                .from(schema.commentTable)
                .where(eq(schema.commentTable.postId, schema.postTable.id))
            ),
            notExists(
              db
                .select({ id: schema.upvoteTable.id })
                .from(schema.upvoteTable)
                .where(
                  and(
                    eq(schema.upvoteTable.postId, schema.postTable.id),
                    ne(schema.upvoteTable.userId, userId)
                  )
                )
            )
          )
        ),

    findMany: ({ boardId, organizationId }: TPostFindMany) => {
      const where: SQL[] = [];
      if (boardId) {
        where.push(eq(schema.postTable.boardId, boardId));
      }

      where.push(eq(schema.postTable.organizationId, organizationId));
      const whereClause = getWhereClause(where);

      return db
        .select(selectPostListFields({ contactFallback: true }))
        .from(schema.postTable)
        .leftJoin(
          schema.userTable,
          eq(schema.userTable.id, schema.postTable.creatorId)
        )
        .leftJoin(
          schema.contactTable,
          eq(schema.contactTable.id, schema.postTable.contactId)
        )
        .where(whereClause);
    },

    findManyPublic: ({ boardId, organizationId }: TPostFindMany) => {
      const where: SQL[] = [
        eq(schema.postTable.organizationId, organizationId),
        // Superseded content stays queryable internally but must not remain
        // publicly listed (same rule as `findSuggestionCandidates`).
        sql`${schema.postTable.archivedAt} is null`,
        sql`${schema.postTable.mergedIntoPostId} is null`,
      ];
      if (boardId) {
        where.push(eq(schema.postTable.boardId, boardId));
      }
      where.push(eq(schema.boardTable.visibility, "PUBLIC"));

      const whereClause = and(...where);

      return db
        .select(selectPostListFields())
        .from(schema.postTable)
        .innerJoin(
          schema.boardTable,
          eq(schema.boardTable.id, schema.postTable.boardId)
        )
        .leftJoin(
          schema.userTable,
          eq(schema.userTable.id, schema.postTable.creatorId)
        )
        .where(whereClause);
    },

    /**
     * Single-post counterpart of `findManyPublic`: same visibility rules
     * (public boards only, no archived or merged posts) keyed by slug.
     * Resolves to `undefined` when no public post matches.
     */
    findPublicBySlug: ({ organizationId, slug }: TPostFindPublicBySlug) => {
      const whereClause = and(
        eq(schema.postTable.organizationId, organizationId),
        eq(schema.postTable.slug, slug),
        // Same rule as `findManyPublic`: superseded content stays queryable
        // internally but must not be publicly readable.
        sql`${schema.postTable.archivedAt} is null`,
        sql`${schema.postTable.mergedIntoPostId} is null`,
        eq(schema.boardTable.visibility, "PUBLIC")
      );

      return db
        .select(selectPostFields())
        .from(schema.postTable)
        .innerJoin(
          schema.boardTable,
          eq(schema.boardTable.id, schema.postTable.boardId)
        )
        .leftJoin(
          schema.userTable,
          eq(schema.userTable.id, schema.postTable.creatorId)
        )
        .where(whereClause)
        .limit(1)
        .pipe(Effect.map((rows) => rows[0]));
    },

    /**
     * Resolves a publicly visible merged source slug to the slug of the
     * surviving target, so public detail routes can redirect inbound links
     * (and merge-notification emails) instead of 404ing. Returns undefined
     * when the source is not merged, either board is private, or the target
     * is itself archived/merged.
     */
    findMergedPublicTargetBySlug: ({
      organizationId,
      slug,
    }: TPostFindPublicBySlug) => {
      const sourcePost = alias(schema.postTable, "merged_source_post");
      const sourceBoard = alias(schema.boardTable, "merged_source_board");
      const targetPost = alias(schema.postTable, "merged_target_post");
      const targetBoard = alias(schema.boardTable, "merged_target_board");

      return db
        .select({ slug: targetPost.slug })
        .from(sourcePost)
        .innerJoin(sourceBoard, eq(sourceBoard.id, sourcePost.boardId))
        .innerJoin(targetPost, eq(targetPost.id, sourcePost.mergedIntoPostId))
        .innerJoin(targetBoard, eq(targetBoard.id, targetPost.boardId))
        .where(
          and(
            eq(sourcePost.organizationId, organizationId),
            eq(sourcePost.slug, slug),
            isNotNull(sourcePost.mergedIntoPostId),
            eq(sourceBoard.visibility, "PUBLIC"),
            isNull(targetPost.archivedAt),
            isNull(targetPost.mergedIntoPostId),
            eq(targetBoard.visibility, "PUBLIC")
          )
        )
        .limit(1)
        .pipe(Effect.map((rows) => rows[0]));
    },

    findSuggestionCandidates: ({
      boardId,
      embedding,
      embeddingModel,
      limit,
      organizationId,
      publicOnly,
    }: TPostSuggestionCandidates) => {
      const where: SQL[] = [
        eq(schema.postTable.organizationId, organizationId),
        sql`${schema.postTable.archivedAt} is null`,
        sql`${schema.postTable.mergedIntoPostId} is null`,
      ];
      if (boardId) {
        where.push(eq(schema.postTable.boardId, boardId));
      }
      if (publicOnly) {
        where.push(eq(schema.boardTable.visibility, "PUBLIC"));
      }
      if (embedding) {
        where.push(isNotNull(schema.postTable.embedding));
        if (embeddingModel) {
          where.push(eq(schema.postTable.embeddingModel, embeddingModel));
        }
      }

      const query = db
        .select({
          ...selectPostFields(),
          distance: embedding
            ? sql<
                number | null
              >`${cosineDistance(schema.postTable.embedding, [...embedding])}`
            : sql<number | null>`null`,
        })
        .from(schema.postTable)
        .innerJoin(
          schema.boardTable,
          eq(schema.boardTable.id, schema.postTable.boardId)
        )
        .leftJoin(
          schema.userTable,
          eq(schema.userTable.id, schema.postTable.creatorId)
        )
        .where(and(...where));

      return embedding
        ? query
            .orderBy(
              asc(cosineDistance(schema.postTable.embedding, [...embedding]))
            )
            .limit(limit)
        : query.orderBy(desc(schema.postTable.updatedAt)).limit(limit);
    },

    isPublicPost: ({ id, organizationId }: TPostById) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ id: schema.postTable.id })
          .from(schema.postTable)
          .innerJoin(
            schema.boardTable,
            eq(schema.boardTable.id, schema.postTable.boardId)
          )
          .where(
            and(
              eq(schema.postTable.id, id),
              eq(schema.postTable.organizationId, organizationId),
              eq(schema.boardTable.visibility, "PUBLIC")
            )
          );
        return rows.length > 0;
      }),

    isUnlocked: ({ id, organizationId }: TPostById) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ id: schema.postTable.id })
          .from(schema.postTable)
          .where(
            and(
              eq(schema.postTable.id, id),
              eq(schema.postTable.organizationId, organizationId),
              sql`${schema.postTable.lockedAt} is null`
            )
          );
        return rows.length > 0;
      }),

    isUnlockedPublic: ({ id, organizationId }: TPostById) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ id: schema.postTable.id })
          .from(schema.postTable)
          .innerJoin(
            schema.boardTable,
            eq(schema.boardTable.id, schema.postTable.boardId)
          )
          .where(
            and(
              eq(schema.postTable.id, id),
              eq(schema.postTable.organizationId, organizationId),
              eq(schema.boardTable.visibility, "PUBLIC"),
              sql`${schema.postTable.lockedAt} is null`
            )
          );
        return rows.length > 0;
      }),

    update: ({
      id,
      organizationId,
      statusId,
      boardId,
      title,
      content,
      excerpt,
      etaQuarter,
    }: TPostUpdateInput) =>
      db
        .update(schema.postTable)
        .set({
          statusId,
          boardId,
          title,
          content,
          excerpt:
            content !== undefined
              ? (excerpt ?? htmlToExcerpt(content))
              : excerpt,
          etaQuarter,
        })
        .where(
          and(
            eq(schema.postTable.id, id),
            eq(schema.postTable.organizationId, organizationId)
          )
        )
        .pipe(Effect.asVoid),

    updateEta: ({
      id,
      organizationId,
      etaQuarter,
    }: {
      id: string;
      organizationId: string;
      etaQuarter: string | null;
    }) =>
      db
        .update(schema.postTable)
        .set({ etaQuarter })
        .where(
          and(
            eq(schema.postTable.id, id),
            eq(schema.postTable.organizationId, organizationId)
          )
        )
        .pipe(Effect.asVoid),

    /**
     * Re-attributes a post to a resolved on-behalf subject. Mirrors the
     * create path: staff attribution stays out of the author fields, so
     * `creatorMemberId` is always cleared and `contactId` always set.
     */
    updateAuthor: ({
      id,
      organizationId,
      creatorId,
      creatorMemberId,
      contactId,
    }: {
      id: string;
      organizationId: string;
      creatorId: string | null;
      creatorMemberId: string | null;
      contactId: string;
    }) =>
      db
        .update(schema.postTable)
        .set({ creatorId, creatorMemberId, contactId })
        .where(
          and(
            eq(schema.postTable.id, id),
            eq(schema.postTable.organizationId, organizationId)
          )
        )
        .pipe(Effect.asVoid),

    updateEmbedding: ({
      embedding,
      expectedContent,
      expectedTitle,
      id,
      model,
      organizationId,
    }: {
      embedding: readonly number[];
      expectedContent: string;
      expectedTitle: string;
      id: string;
      model: string;
      organizationId: string;
    }) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        yield* db
          .update(schema.postTable)
          .set({
            embeddedAt: now,
            embedding: [...embedding],
            embeddingModel: model,
          })
          .where(
            and(
              eq(schema.postTable.id, id),
              eq(schema.postTable.organizationId, organizationId),
              eq(schema.postTable.title, expectedTitle),
              eq(schema.postTable.content, expectedContent)
            )
          )
          .pipe(Effect.asVoid);
      }),

    adminUpdate: ({ id, organizationId, archived, locked }: TPostAdminUpdate) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        yield* db
          .update(schema.postTable)
          .set({
            archivedAt:
              archived === undefined ? undefined : archived ? now : null,
            lockedAt: locked === undefined ? undefined : locked ? now : null,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.postTable.id, id),
              eq(schema.postTable.organizationId, organizationId)
            )
          )
          .pipe(Effect.asVoid);
      }),

    delete: ({
      id,
      organizationId,
      boardId,
      creatorId,
      onlyIfNew,
    }: TPostDelete) => {
      const ids = isString(id) ? [id] : id;
      const postScope = and(
        inArray(schema.postTable.id, ids),
        eq(schema.postTable.organizationId, organizationId),
        eq(schema.postTable.boardId, boardId)
      );

      return Effect.gen(function* () {
        // Lock the posts before checking engagement. Comment/upvote inserts
        // reference these rows, so concurrent activity waits for this check.
        const posts = yield* db
          .select({ id: schema.postTable.id })
          .from(schema.postTable)
          .where(postScope)
          .for("update");

        // Nothing matched (missing id or wrong org/board) — report "not
        // deleted" instead of vacuously comparing two empty lists.
        if (posts.length === 0) {
          return false;
        }

        if (onlyIfNew) {
          const newPosts = yield* db
            .select({ id: schema.postTable.id })
            .from(schema.postTable)
            .where(
              and(
                postScope,
                eq(schema.postTable.creatorId, creatorId),
                notExists(
                  db
                    .select({ id: schema.commentTable.id })
                    .from(schema.commentTable)
                    .where(eq(schema.commentTable.postId, schema.postTable.id))
                ),
                notExists(
                  db
                    .select({ id: schema.upvoteTable.id })
                    .from(schema.upvoteTable)
                    .where(
                      and(
                        eq(schema.upvoteTable.postId, schema.postTable.id),
                        ne(schema.upvoteTable.userId, creatorId)
                      )
                    )
                )
              )
            );

          if (newPosts.length !== posts.length) {
            return false;
          }
        }

        const deleted = yield* db
          .delete(schema.postTable)
          .where(postScope)
          .returning({ id: schema.postTable.id });

        return deleted.length === posts.length;
      });
    },

    create: ({
      id,
      boardId,
      organizationId,
      title,
      content,
      statusId,
      creatorId,
      creatorMemberId,
      contactId,
      metadata,
      source,
      excerpt: inputExcerpt,
      etaQuarter,
    }: TPostCreate) =>
      Effect.gen(function* () {
        const excerpt = inputExcerpt ?? htmlToExcerpt(content);
        const baseSlug = slugify(title);

        // Slugs are unique per organization (see post_organizationId_slug_uidx),
        // so a title that already exists anywhere in the organization must be
        // deduplicated instead of rejected. Each insert attempt runs in its own
        // savepoint (nested db.transaction), so a unique-violation failure rolls
        // back without aborting the enclosing transaction and the next suffix
        // can be tried. The native Effect retry policy re-executes the insert
        // with the next candidate slug until one succeeds; when the suffix
        // space is exhausted a typed PostAlreadyExistsError is returned.
        const MAX_SLUG_ATTEMPTS = 10;
        const slugCollision = { _tag: "SlugCollision" } as const;

        // The candidate slug depends on the attempt index, so the insert
        // effect is rebuilt lazily per attempt via Effect.suspend. Effect.retry
        // re-executes it, incrementing the counter on each retry.
        let attemptIndex = 0;
        const tryCreate = Effect.suspend(() =>
          Effect.gen(function* () {
            const slug =
              attemptIndex === 0 ? baseSlug : `${baseSlug}-${attemptIndex + 1}`;
            attemptIndex += 1;
            const now = yield* DateTime.nowAsDate;

            return yield* db
              .transaction(() =>
                db
                  .insert(schema.postTable)
                  .values({
                    id,
                    boardId,
                    organizationId,
                    title,
                    content,
                    excerpt,
                    statusId,
                    creatorId: creatorId ?? null,
                    creatorMemberId: creatorMemberId ?? null,
                    contactId: contactId ?? null,
                    source: source ?? "DASHBOARD",
                    metadata: metadata ?? {},
                    createdAt: now,
                    slug,
                    updatedAt: now,
                    etaQuarter: etaQuarter ?? null,
                  })
                  .pipe(Effect.as(slug))
              )
              .pipe(
                Effect.catchIf(
                  (error) =>
                    isUniqueViolation(error) &&
                    getUniqueViolationConstraint(error) ===
                      "post_organizationId_slug_uidx",
                  () => Effect.fail(slugCollision)
                )
              );
          })
        );

        return yield* Effect.retry(tryCreate, {
          // Initial attempt plus MAX_SLUG_ATTEMPTS - 1 retries.
          times: MAX_SLUG_ATTEMPTS - 1,
          while: (error) => error._tag === "SlugCollision",
        }).pipe(
          Effect.catchTag(
            "SlugCollision",
            () =>
              new PostAlreadyExistsError({
                message: "A post with this slug already exists",
              })
          )
        );
      }),

    merge: ({ organizationId, sourcePostId, targetPostId }: TPostMerge) =>
      db.transaction((tx) =>
        Effect.gen(function* () {
          const now = yield* DateTime.nowAsDate;
          const posts = yield* tx
            .select({
              id: schema.postTable.id,
              archivedAt: schema.postTable.archivedAt,
              mergedIntoPostId: schema.postTable.mergedIntoPostId,
            })
            .from(schema.postTable)
            .where(
              and(
                inArray(schema.postTable.id, [sourcePostId, targetPostId]),
                eq(schema.postTable.organizationId, organizationId)
              )
            );

          const sourcePost = posts.find((post) => post.id === sourcePostId);
          const targetPost = posts.find((post) => post.id === targetPostId);

          if (!(sourcePost && targetPost)) {
            return yield* new FailedToMergePostError({
              message: "Source or target post not found",
            });
          }
          if (sourcePostId === targetPostId) {
            return yield* new FailedToMergePostError({
              message: "Source and target posts must be different",
            });
          }
          if (sourcePost.mergedIntoPostId) {
            return yield* new FailedToMergePostError({
              message: "Source post is already merged into another post",
            });
          }
          if (sourcePost.archivedAt) {
            return yield* new FailedToMergePostError({
              message: "Source post is archived and cannot be merged",
            });
          }
          if (targetPost.mergedIntoPostId) {
            return yield* new FailedToMergePostError({
              message: "Target post is already merged into another post",
            });
          }
          if (targetPost.archivedAt) {
            return yield* new FailedToMergePostError({
              message: "Target post is archived and cannot be a merge target",
            });
          }

          // The partial unique index `comment_post_pinned_uidx` allows at
          // most one pinned comment per post. When the target already has a
          // pinned comment, unpin the source's first so the bulk
          // reassignment below cannot violate the index; otherwise the
          // source's pinned comment becomes the target's.
          const [targetPinnedComment] = yield* tx
            .select({ id: schema.commentTable.id })
            .from(schema.commentTable)
            .where(
              and(
                eq(schema.commentTable.postId, targetPostId),
                isNotNull(schema.commentTable.pinnedAt)
              )
            )
            .limit(1);
          if (targetPinnedComment) {
            yield* tx
              .update(schema.commentTable)
              .set({ pinnedAt: null })
              .where(
                and(
                  eq(schema.commentTable.postId, sourcePostId),
                  isNotNull(schema.commentTable.pinnedAt)
                )
              );
          }
          yield* tx
            .update(schema.commentTable)
            .set({ postId: targetPostId })
            .where(eq(schema.commentTable.postId, sourcePostId));

          // Set-based reassignment: move every source row without a twin on
          // the target, then drop the leftover twins. Previously one
          // SELECT + UPDATE/DELETE per row (2n+1 round-trips holding the
          // merge transaction open); now two statements per table.
          // Twins are unique-keyed (upvote: user+post, reaction:
          // user+post+emoji, tag: post+tag), so a moved row can never
          // collide with a later one.
          const targetUpvote = alias(schema.upvoteTable, "merge_target_upvote");
          yield* tx
            .update(schema.upvoteTable)
            .set({ postId: targetPostId })
            .where(
              and(
                eq(schema.upvoteTable.postId, sourcePostId),
                notExists(
                  tx
                    .select({ id: targetUpvote.id })
                    .from(targetUpvote)
                    .where(
                      and(
                        eq(targetUpvote.postId, targetPostId),
                        eq(targetUpvote.userId, schema.upvoteTable.userId)
                      )
                    )
                )
              )
            );
          yield* tx
            .delete(schema.upvoteTable)
            .where(eq(schema.upvoteTable.postId, sourcePostId));

          const targetReaction = alias(
            schema.postReactionTable,
            "merge_target_reaction"
          );
          yield* tx
            .update(schema.postReactionTable)
            .set({ postId: targetPostId })
            .where(
              and(
                eq(schema.postReactionTable.postId, sourcePostId),
                notExists(
                  tx
                    .select({ id: targetReaction.id })
                    .from(targetReaction)
                    .where(
                      and(
                        eq(targetReaction.postId, targetPostId),
                        eq(
                          targetReaction.userId,
                          schema.postReactionTable.userId
                        ),
                        eq(targetReaction.emoji, schema.postReactionTable.emoji)
                      )
                    )
                )
              )
            );
          yield* tx
            .delete(schema.postReactionTable)
            .where(eq(schema.postReactionTable.postId, sourcePostId));

          const targetPostTag = alias(
            schema.postTagTable,
            "merge_target_post_tag"
          );
          yield* tx
            .update(schema.postTagTable)
            .set({ postId: targetPostId })
            .where(
              and(
                eq(schema.postTagTable.postId, sourcePostId),
                notExists(
                  tx
                    .select({ id: targetPostTag.id })
                    .from(targetPostTag)
                    .where(
                      and(
                        eq(targetPostTag.postId, targetPostId),
                        eq(targetPostTag.tagId, schema.postTagTable.tagId)
                      )
                    )
                )
              )
            );
          yield* tx
            .delete(schema.postTagTable)
            .where(eq(schema.postTagTable.postId, sourcePostId));

          // Followers move with the post so subscribers keep receiving
          // updates. A user following both posts keeps the target
          // subscription; the duplicate source row is dropped.
          const targetSubscription = alias(
            schema.postSubscriptionTable,
            "merge_target_subscription"
          );
          yield* tx
            .update(schema.postSubscriptionTable)
            .set({ postId: targetPostId })
            .where(
              and(
                eq(schema.postSubscriptionTable.postId, sourcePostId),
                notExists(
                  tx
                    .select({ id: targetSubscription.id })
                    .from(targetSubscription)
                    .where(
                      and(
                        eq(targetSubscription.postId, targetPostId),
                        eq(
                          targetSubscription.userId,
                          schema.postSubscriptionTable.userId
                        )
                      )
                    )
                )
              )
            );
          yield* tx
            .delete(schema.postSubscriptionTable)
            .where(eq(schema.postSubscriptionTable.postId, sourcePostId));

          // Email subscribers follow the surviving post too, so a merged-away
          // post does not silently orphan their consent. A contact who
          // already has a target-topic row keeps that row (and its explicit
          // verified/unsubscribed state); the duplicate source row is dropped.
          const targetEmailSubscription = alias(
            schema.emailSubscriptionTable,
            "merge_target_email_subscription"
          );
          yield* tx
            .update(schema.emailSubscriptionTable)
            .set({ topicId: targetPostId })
            .where(
              and(
                eq(schema.emailSubscriptionTable.topicType, "post"),
                eq(schema.emailSubscriptionTable.topicId, sourcePostId),
                notExists(
                  tx
                    .select({ id: targetEmailSubscription.id })
                    .from(targetEmailSubscription)
                    .where(
                      and(
                        eq(
                          targetEmailSubscription.contactId,
                          schema.emailSubscriptionTable.contactId
                        ),
                        eq(targetEmailSubscription.topicType, "post"),
                        eq(targetEmailSubscription.topicId, targetPostId)
                      )
                    )
                )
              )
            );
          yield* tx
            .delete(schema.emailSubscriptionTable)
            .where(
              and(
                eq(schema.emailSubscriptionTable.topicType, "post"),
                eq(schema.emailSubscriptionTable.topicId, sourcePostId)
              )
            );

          yield* tx
            .update(schema.postTable)
            .set({
              archivedAt: now,
              mergedAt: now,
              mergedIntoPostId: targetPostId,
              updatedAt: now,
            })
            .where(
              and(
                eq(schema.postTable.id, sourcePostId),
                eq(schema.postTable.organizationId, organizationId)
              )
            );
        })
      ),
  };
});

export class PostRepository extends Context.Service<PostRepository>()(
  "PostRepository",
  {
    make: makePostRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
