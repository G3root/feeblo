import { currentDb, schema } from "@feeblo/db";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { currentService } from "../../current-service";
import type { Cursor } from "../../public-api/cursor";
import { withRemapDbErrors } from "../../rpc-errors";

/** An author reduced to a classification and display fields — never an id. */
export type PublicApiCommentAuthor = {
  readonly type: "member" | "end_user";
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
};

/**
 * What the comment mapper is allowed to read.
 *
 * Narrow for the same reason as `PublicApiPostSource`: `comment` also carries
 * `userId` and `memberId`, and the query reduces the second one to a
 * classification in SQL so neither identifier can reach a response. The author
 * joins `user` only — a comment has no contact column — so it carries the
 * account's own name and avatar.
 */
export type PublicApiCommentSource = {
  readonly id: string;
  readonly postId: string;
  readonly content: string;
  readonly visibility: "PUBLIC" | "INTERNAL";
  readonly parentCommentId: string | null;
  readonly pinnedAt: Date | null;
  readonly author: PublicApiCommentAuthor;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type PublicApiCommentPage = {
  readonly comments: readonly PublicApiCommentSource[];
  readonly nextCursor: Cursor | null;
};

/**
 * The comment column list, and the only place a comment field is selected from.
 *
 * `userId` and `memberId` are deliberately absent: `userId` is the internal
 * actor identifier `public-actor.ts` forbids, and `memberId` is reduced to the
 * author classification in SQL rather than selected and branched on in
 * TypeScript, so neither can leak through a mapper.
 */
const COMMENT_COLUMNS = {
  id: schema.commentTable.id,
  postId: schema.commentTable.postId,
  content: schema.commentTable.content,
  visibility: schema.commentTable.visibility,
  parentCommentId: schema.commentTable.parentCommentId,
  pinnedAt: schema.commentTable.pinnedAt,
  createdAt: schema.commentTable.createdAt,
  updatedAt: schema.commentTable.updatedAt,
  authorType: sql<
    "member" | "end_user"
  >`case when ${schema.commentTable.memberId} is null then 'end_user' else 'member' end`,
  authorName: schema.userTable.name,
  authorAvatarUrl: schema.userTable.image,
} as const;

type CommentRow = {
  id: string;
  postId: string;
  content: string;
  visibility: "PUBLIC" | "INTERNAL";
  parentCommentId: string | null;
  pinnedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  authorType: "member" | "end_user";
  authorName: string | null;
  authorAvatarUrl: string | null;
};

const toCommentSource = (row: CommentRow): PublicApiCommentSource => ({
  id: row.id,
  postId: row.postId,
  content: row.content,
  visibility: row.visibility,
  parentCommentId: row.parentCommentId,
  pinnedAt: row.pinnedAt,
  author: {
    type: row.authorType,
    displayName: row.authorName,
    avatarUrl: row.authorAvatarUrl,
  },
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/**
 * Comment reads as the Public API alone performs them.
 *
 * The writes are the dashboard's own `CommentService` — the same sanitizer,
 * transaction, timeline entry, and notification fan-out — so this service
 * holds only the reads, whose projection is public-specific: `userId` and
 * `memberId` must never be selected, and the author classification is computed
 * in SQL.
 */
const makePublicApiCommentRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  return {
    /**
     * One page of a post's comments, newest first.
     *
     * Ordered and paged exactly like a board's posts — the same `(createdAt,
     * id)` tuple and the same cursor — so a caller learns one paging rule for
     * the whole API. A pinned comment is part of the page like any other and
     * reports its `pinnedAt`; it is deliberately not floated to the top,
     * because doing so would need a second sort key in the cursor and make one
     * endpoint page unlike every other. Fetches `limit + 1` rows to learn
     * whether another page exists without a second query.
     */
    listPostComments: ({
      cursor,
      limit,
      organizationId,
      postId,
    }: {
      cursor: Cursor | null;
      limit: number;
      organizationId: string;
      postId: string;
    }) =>
      Effect.gen(function* () {
        // Distinguish a post with no comments from one that does not exist in
        // this workspace before running the page query: otherwise both come
        // back as a successful empty page, and the caller cannot tell them
        // apart. Another workspace's post is reported the same way as a
        // missing one, so the id cannot be used to probe other workspaces.
        const post = yield* db
          .select({ id: schema.postTable.id })
          .from(schema.postTable)
          .where(
            and(
              eq(schema.postTable.id, postId),
              eq(schema.postTable.organizationId, organizationId)
            )
          )
          .limit(1);

        if (post.length === 0) {
          return Option.none();
        }

        const conditions: SQL[] = [
          eq(schema.commentTable.organizationId, organizationId),
          eq(schema.commentTable.postId, postId),
        ];
        if (cursor !== null) {
          conditions.push(
            sql`(${schema.commentTable.createdAt}, ${schema.commentTable.id}) < (${cursor.createdAt}, ${cursor.id})`
          );
        }

        const rows = yield* db
          .select(COMMENT_COLUMNS)
          .from(schema.commentTable)
          // The author is joined rather than left-joined: `comment.userId` is
          // not null, so a comment always has an account behind it.
          .innerJoin(
            schema.userTable,
            eq(schema.userTable.id, schema.commentTable.userId)
          )
          .where(and(...conditions))
          .orderBy(
            desc(schema.commentTable.createdAt),
            desc(schema.commentTable.id)
          )
          .limit(limit + 1);

        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const lastRow = pageRows.at(-1);

        return Option.some({
          comments: pageRows.map(toCommentSource),
          nextCursor:
            hasMore && lastRow !== undefined
              ? { createdAt: lastRow.createdAt, id: lastRow.id }
              : null,
        } satisfies PublicApiCommentPage);
      }).pipe(withRemapDbErrors("PublicApiComment", "select")),

    /** One comment of the calling workspace, or nothing. */
    findComment: ({
      commentId,
      organizationId,
    }: {
      commentId: string;
      organizationId: string;
    }) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select(COMMENT_COLUMNS)
          .from(schema.commentTable)
          .innerJoin(
            schema.userTable,
            eq(schema.userTable.id, schema.commentTable.userId)
          )
          .where(
            and(
              eq(schema.commentTable.id, commentId),
              eq(schema.commentTable.organizationId, organizationId)
            )
          )
          .limit(1);

        return Option.fromNullishOr(rows.at(0)).pipe(
          Option.map(toCommentSource)
        );
      }).pipe(withRemapDbErrors("PublicApiComment", "select")),

    /**
     * The post a create comments on: whether it exists in this workspace.
     *
     * Only existence is answered here. Whether the post still accepts
     * comments — it may be locked or merged into another post — is decided by
     * `CommentService.create`, inside the write's own transaction and under
     * the post row's lock, so the state cannot change between the check and
     * the insert. A post that does not exist in this workspace, or belongs to
     * another one, is reported as missing here so the id cannot probe at all.
     */
    findCommentTarget: ({
      organizationId,
      postId,
    }: {
      organizationId: string;
      postId: string;
    }) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ id: schema.postTable.id })
          .from(schema.postTable)
          .where(
            and(
              eq(schema.postTable.id, postId),
              eq(schema.postTable.organizationId, organizationId)
            )
          )
          .limit(1);

        return Option.fromNullishOr(rows.at(0));
      }).pipe(withRemapDbErrors("PublicApiComment", "select")),
  };
});

export class PublicApiCommentRepository extends Context.Service<PublicApiCommentRepository>()(
  "PublicApiCommentRepository",
  {
    make: makePublicApiCommentRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}

export const currentPublicApiCommentRepository = currentService(
  PublicApiCommentRepository
);
