import { currentDb, schema } from "@feeblo/db";
import type { TPostStatusType } from "@feeblo/domain-contracts/post-status-type";
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { withRemapDbErrors } from "../rpc-errors";
import type { Cursor } from "./cursor";

/** An author reduced to a classification and display fields — never an id. */
export type PublicApiPostAuthor = {
  readonly type: "member" | "end_user";
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
};

/**
 * What a mapper is allowed to read.
 *
 * Declared structurally and narrowly on purpose: a mapper cannot accept a
 * dashboard row (which carries internal actor ids) and pass it through, and a
 * column added to the `post` table cannot reach a public response without being
 * added here first.
 */
export type PublicApiPostSource = {
  readonly id: string;
  readonly boardId: string;
  readonly title: string;
  readonly slug: string;
  readonly excerpt: string;
  readonly etaQuarter: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly lockedAt: Date | null;
  readonly archivedAt: Date | null;
  readonly mergedIntoPostId: string | null;
  readonly status: {
    readonly id: string;
    readonly name: string;
    readonly type: TPostStatusType;
  };
  readonly author: PublicApiPostAuthor;
  readonly voteCount: number;
  readonly commentCount: number;
  readonly tags: readonly { readonly id: string; readonly name: string }[];
};

export type PublicApiListedPost = PublicApiPostSource & {
  readonly boardSlug: string;
};

export type PublicApiDetailedPost = PublicApiPostSource & {
  readonly boardSlug: string;
  readonly content: string;
};

export type PublicApiPostPage = {
  readonly posts: readonly PublicApiListedPost[];
  readonly nextCursor: Cursor | null;
};

interface TListBoardPosts {
  boardId: string;
  cursor: Cursor | null;
  includeArchived: boolean;
  limit: number;
  organizationId: string;
  statusId: string | null;
}

interface TFindPost {
  organizationId: string;
  postId: string;
}

/**
 * The author classification is computed in SQL.
 *
 * `creatorMemberId` decides whether an author is workspace staff or an outside
 * end user, and it is an internal identifier that must not leave the database.
 * Reducing it to a literal here — rather than selecting it and branching in
 * TypeScript — keeps the identifier out of the result set, out of logs, and out
 * of any error message that might embed a row.
 */
const POST_COLUMNS = {
  id: schema.postTable.id,
  boardId: schema.postTable.boardId,
  boardSlug: schema.boardTable.slug,
  title: schema.postTable.title,
  slug: schema.postTable.slug,
  excerpt: schema.postTable.excerpt,
  etaQuarter: schema.postTable.etaQuarter,
  createdAt: schema.postTable.createdAt,
  updatedAt: schema.postTable.updatedAt,
  lockedAt: schema.postTable.lockedAt,
  archivedAt: schema.postTable.archivedAt,
  mergedIntoPostId: schema.postTable.mergedIntoPostId,
  statusId: schema.postStatusTable.id,
  // User-facing label; a workspace may leave it empty until it customizes the
  // status, in which case the mapper falls back to the canonical type.
  statusLabel: schema.postStatusTable.label,
  statusType: schema.postStatusTable.type,
  authorType: sql<
    "member" | "end_user"
  >`case when ${schema.postTable.creatorMemberId} is null then 'end_user' else 'member' end`,
  // Contact fallback mirrors the dashboard so a widget submission shows the
  // customer's name; the portal deliberately omits it because it serves
  // unauthenticated visitors. A Public API caller is the workspace itself.
  authorName: sql<
    string | null
  >`coalesce(${schema.userTable.name}, ${schema.contactTable.name})`,
  authorAvatarUrl: sql<
    string | null
  >`coalesce(${schema.userTable.image}, ${schema.contactTable.avatar})`,
} as const;

type PostRow = {
  id: string;
  boardId: string;
  boardSlug: string;
  title: string;
  slug: string;
  excerpt: string;
  etaQuarter: string | null;
  createdAt: Date;
  updatedAt: Date;
  lockedAt: Date | null;
  archivedAt: Date | null;
  mergedIntoPostId: string | null;
  statusId: string;
  statusLabel: string;
  statusType: TPostStatusType;
  authorType: "member" | "end_user";
  authorName: string | null;
  authorAvatarUrl: string | null;
};

const toSource = (
  row: PostRow,
  counts: { voteCount: number; commentCount: number },
  tags: readonly { id: string; name: string }[]
): PublicApiPostSource => ({
  id: row.id,
  boardId: row.boardId,
  title: row.title,
  slug: row.slug,
  excerpt: row.excerpt,
  etaQuarter: row.etaQuarter,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  lockedAt: row.lockedAt,
  archivedAt: row.archivedAt,
  mergedIntoPostId: row.mergedIntoPostId,
  status: { id: row.statusId, name: row.statusLabel, type: row.statusType },
  author: {
    type: row.authorType,
    displayName: row.authorName,
    avatarUrl: row.authorAvatarUrl,
  },
  voteCount: counts.voteCount,
  commentCount: counts.commentCount,
  tags,
});

/**
 * Read-only projections for the Public API.
 *
 * Its own queries rather than `PostRepository`'s: the rules differ (a private
 * board is readable with a key, archived and merged posts are handled per
 * request, and vote and comment counts have no dashboard equivalent), and the
 * column list is the first line of defence against exposing actor identities.
 */
const makePublicApiRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  const countByPostIds = (postIds: readonly string[]) =>
    Effect.gen(function* () {
      const voteRows = yield* db
        .select({
          postId: schema.upvoteTable.postId,
          total: count(schema.upvoteTable.id),
        })
        .from(schema.upvoteTable)
        .where(inArray(schema.upvoteTable.postId, postIds))
        .groupBy(schema.upvoteTable.postId);

      // Only public comments are counted: an internal comment is a workspace
      // note, and counting it would make this number disagree with the same
      // post's count on the public portal.
      const commentRows = yield* db
        .select({
          postId: schema.commentTable.postId,
          total: count(schema.commentTable.id),
        })
        .from(schema.commentTable)
        .where(
          and(
            inArray(schema.commentTable.postId, postIds),
            eq(schema.commentTable.visibility, "PUBLIC")
          )
        )
        .groupBy(schema.commentTable.postId);

      return {
        voteCount: new Map(
          voteRows.map((row) => [row.postId, Number(row.total)])
        ),
        commentCount: new Map(
          commentRows.map((row) => [row.postId, Number(row.total)])
        ),
      };
    });

  const tagsByPostIds = (postIds: readonly string[]) =>
    db
      .select({
        postId: schema.postTagTable.postId,
        id: schema.tagTable.id,
        name: schema.tagTable.name,
      })
      .from(schema.postTagTable)
      .innerJoin(
        schema.tagTable,
        eq(schema.tagTable.id, schema.postTagTable.tagId)
      )
      .where(inArray(schema.postTagTable.postId, postIds));

  return {
    /**
     * One page of a board's posts, newest first.
     *
     * Fetches `limit + 1` rows so the caller learns whether another page exists
     * without a second query, and pages on `(createdAt, id)` — the same tuple
     * the cursor carries — so concurrently inserted posts cannot make a caller
     * skip or repeat a row the way an offset would.
     */
    listBoardPosts: ({
      boardId,
      cursor,
      includeArchived,
      limit,
      organizationId,
      statusId,
    }: TListBoardPosts) =>
      Effect.gen(function* () {
        // Distinguish an empty board from one that does not exist in this
        // workspace before running the page query: otherwise both come back as
        // a successful empty page, and the caller cannot tell them apart. A
        // board of another workspace is reported the same way as a missing
        // one, so the id cannot be used to probe other workspaces.
        const board = yield* db
          .select({ id: schema.boardTable.id })
          .from(schema.boardTable)
          .where(
            and(
              eq(schema.boardTable.id, boardId),
              eq(schema.boardTable.organizationId, organizationId)
            )
          )
          .limit(1);

        if (board.length === 0) {
          return Option.none();
        }

        const conditions: SQL[] = [
          eq(schema.postTable.organizationId, organizationId),
          eq(schema.postTable.boardId, boardId),
          // A merged post is superseded by its survivor. Same rule as the
          // portal, and it keeps `mergedIntoPostId` meaningful rather than
          // listing duplicates.
          isNull(schema.postTable.mergedIntoPostId),
        ];
        if (!includeArchived) {
          conditions.push(isNull(schema.postTable.archivedAt));
        }
        if (statusId !== null) {
          conditions.push(eq(schema.postTable.statusId, statusId));
        }
        if (cursor !== null) {
          conditions.push(
            sql`(${schema.postTable.createdAt}, ${schema.postTable.id}) < (${cursor.createdAt}, ${cursor.id})`
          );
        }

        const rows = yield* db
          .select(POST_COLUMNS)
          .from(schema.postTable)
          .innerJoin(
            schema.boardTable,
            eq(schema.boardTable.id, schema.postTable.boardId)
          )
          .innerJoin(
            schema.postStatusTable,
            eq(schema.postStatusTable.id, schema.postTable.statusId)
          )
          .leftJoin(
            schema.userTable,
            eq(schema.userTable.id, schema.postTable.creatorId)
          )
          .leftJoin(
            schema.contactTable,
            eq(schema.contactTable.id, schema.postTable.contactId)
          )
          .where(and(...conditions))
          .orderBy(desc(schema.postTable.createdAt), desc(schema.postTable.id))
          .limit(limit + 1);

        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        if (pageRows.length === 0) {
          return Option.some({ posts: [], nextCursor: null });
        }

        const postIds = pageRows.map((row) => row.id);
        const counts = yield* countByPostIds(postIds);
        const tagRows = yield* tagsByPostIds(postIds);

        const tagsByPost = new Map<string, { id: string; name: string }[]>();
        for (const tag of tagRows) {
          const existing = tagsByPost.get(tag.postId) ?? [];
          existing.push({ id: tag.id, name: tag.name });
          tagsByPost.set(tag.postId, existing);
        }

        const lastRow = pageRows[pageRows.length - 1];

        return Option.some({
          posts: pageRows.map((row) => ({
            ...toSource(
              row,
              {
                voteCount: counts.voteCount.get(row.id) ?? 0,
                commentCount: counts.commentCount.get(row.id) ?? 0,
              },
              tagsByPost.get(row.id) ?? []
            ),
            boardSlug: row.boardSlug,
          })),
          nextCursor:
            hasMore && lastRow !== undefined
              ? { createdAt: lastRow.createdAt, id: lastRow.id }
              : null,
        });
      }).pipe(withRemapDbErrors("PublicApiPost", "select")),

    /** A single post, including its stored (already sanitized) body. */
    findPost: ({ organizationId, postId }: TFindPost) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ ...POST_COLUMNS, content: schema.postTable.content })
          .from(schema.postTable)
          .innerJoin(
            schema.boardTable,
            eq(schema.boardTable.id, schema.postTable.boardId)
          )
          .innerJoin(
            schema.postStatusTable,
            eq(schema.postStatusTable.id, schema.postTable.statusId)
          )
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
              eq(schema.postTable.id, postId),
              eq(schema.postTable.organizationId, organizationId)
            )
          )
          .limit(1);

        const row = rows.at(0);
        if (row === undefined) {
          return Option.none();
        }

        const counts = yield* countByPostIds([row.id]);
        const tagRows = yield* tagsByPostIds([row.id]);

        return Option.some({
          ...toSource(
            row,
            {
              voteCount: counts.voteCount.get(row.id) ?? 0,
              commentCount: counts.commentCount.get(row.id) ?? 0,
            },
            tagRows.map((tag) => ({ id: tag.id, name: tag.name }))
          ),
          boardSlug: row.boardSlug,
          content: row.content,
        });
      }).pipe(withRemapDbErrors("PublicApiPost", "select")),
  };
});

export class PublicApiRepository extends Context.Service<PublicApiRepository>()(
  "PublicApiRepository",
  {
    make: makePublicApiRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}

/**
 * Reads the repository from the fiber context.
 *
 * `HttpApiBuilder` does not thread a handler's service requirements through the
 * route layer, so handlers take services from the context the composition
 * provides — the same shape as `currentHttpApiSession`.
 */
export const currentPublicApiRepository = Effect.context<never>().pipe(
  Effect.map((context) => Context.getUnsafe(context, PublicApiRepository))
);
