/** biome-ignore-all lint/style/noNestedTernary: <explanation> */
import { DB } from "@feeblo/db";
import { user as userTable } from "@feeblo/db/schema/auth";
import {
  comment as commentTable,
  postReaction as postReactionTable,
  post as postTable,
  postTag as postTagTable,
  upvote as upvoteTable,
} from "@feeblo/db/schema/feedback";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { slugify } from "@feeblo/utils/url";
import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import { Effect, Array as EffectArray } from "effect";
import type { TPostAdminUpdate, TPostUpdate } from "./schema";

type TPostFindMany = {
  boardId?: string | null | undefined;
  organizationId: string;
  userId?: string | null | undefined;
};

type TPostDelete = {
  id: string | readonly string[];
  organizationId: string;
  boardId: string;
};

type TPostCreate = {
  id: string;
  boardId: string;
  organizationId: string;
  title: string;
  content: string;
  statusId: string;
  creatorId: string;
  creatorMemberId?: string;
};

type TPostMerge = {
  organizationId: string;
  sourcePostId: string;
  targetPostId: string;
};

type TPostFindByCreatorId = {
  id: string;
  organizationId: string;
  userId: string;
  boardId: string;
};

type TPostFindByCreatorIds = {
  ids: readonly string[];
  organizationId: string;
  userId: string;
  boardId: string;
};

const makePostRepository = Effect.gen(function* () {
  const db = yield* DB;

  return {
    findByCreatorId: ({
      id,
      organizationId,
      userId,
      boardId,
    }: TPostFindByCreatorId) => {
      return db
        .select({ id: postTable.id })
        .from(postTable)
        .where(
          and(
            eq(postTable.id, id),
            eq(postTable.organizationId, organizationId),
            eq(postTable.creatorId, userId),
            eq(postTable.boardId, boardId)
          )
        )
        .pipe(Effect.map(EffectArray.get(0)));
    },
    findByCreatorIds: ({
      ids,
      organizationId,
      userId,
      boardId,
    }: TPostFindByCreatorIds) => {
      return db
        .select({ id: postTable.id })
        .from(postTable)
        .where(
          and(
            inArray(postTable.id, ids),
            eq(postTable.organizationId, organizationId),
            eq(postTable.creatorId, userId),
            eq(postTable.boardId, boardId)
          )
        );
    },
    findMany: ({ boardId, organizationId, userId }: TPostFindMany) => {
      const where: SQL[] = [];
      if (boardId) {
        where.push(eq(postTable.boardId, boardId));
      }

      where.push(eq(postTable.organizationId, organizationId));
      const whereClause = where.length > 1 ? and(...where) : where[0];
      const hasUserUpVotedExpr = userId
        ? sql<boolean>`exists(select 1 from ${upvoteTable} where ${upvoteTable.postId} = ${postTable.id} and ${upvoteTable.userId} = ${userId})`
        : sql<boolean>`false`;
      const upvoteCounts = db
        .select({
          postId: upvoteTable.postId,
          upVotes: sql<number>`count(*)::int`.as("upVotes"),
        })
        .from(upvoteTable)
        .groupBy(upvoteTable.postId)
        .as("upvote_counts");
      const excerptExpr = sql<string>`coalesce(nullif(${postTable.excerpt}, ''), trim(regexp_replace(regexp_replace(${postTable.content}, '<[^>]+>', ' ', 'gi'), '\\s+', ' ', 'g')))`;

      return db
        .select({
          id: postTable.id,
          title: postTable.title,
          boardId: postTable.boardId,
          slug: postTable.slug,
          content: postTable.content,
          excerpt: excerptExpr,
          upVotes: sql<number>`coalesce(${upvoteCounts.upVotes}, 0)`,
          statusId: postTable.statusId,
          createdAt: postTable.createdAt,
          updatedAt: postTable.updatedAt,
          organizationId: postTable.organizationId,
          lockedAt: postTable.lockedAt,
          archivedAt: postTable.archivedAt,
          mergedIntoPostId: postTable.mergedIntoPostId,
          mergedAt: postTable.mergedAt,
          user: {
            name: sql<string | null>`${userTable.name}`,
            image: sql<string | null>`${userTable.image}`,
          },
          hasUserUpVoted: hasUserUpVotedExpr,
          creatorMemberId: postTable.creatorMemberId,
          creatorId: postTable.creatorId,
        })
        .from(postTable)
        .leftJoin(upvoteCounts, eq(upvoteCounts.postId, postTable.id))
        .leftJoin(userTable, eq(userTable.id, postTable.creatorId))
        .where(whereClause);
    },

    update: ({
      id,
      organizationId,
      statusId,
      boardId,
      title,
      content,
    }: TPostUpdate) =>
      db
        .update(postTable)
        .set({
          statusId,
          boardId,
          title,
          content,
          excerpt: htmlToExcerpt(content),
        })
        .where(
          and(
            eq(postTable.id, id),
            eq(postTable.organizationId, organizationId)
          )
        )
        .pipe(Effect.asVoid),

    adminUpdate: ({ id, organizationId, archived, locked }: TPostAdminUpdate) =>
      db
        .update(postTable)
        .set({
          archivedAt:
            archived === undefined ? undefined : archived ? new Date() : null,
          lockedAt:
            locked === undefined ? undefined : locked ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(postTable.id, id),
            eq(postTable.organizationId, organizationId)
          )
        )
        .pipe(Effect.asVoid),

    delete: ({ id, organizationId, boardId }: TPostDelete) => {
      const where: SQL[] = [];

      if (typeof id === "string") {
        where.push(eq(postTable.id, id));
      } else {
        where.push(inArray(postTable.id, id));
      }

      return db
        .delete(postTable)
        .where(
          and(
            ...where,
            eq(postTable.organizationId, organizationId),
            eq(postTable.boardId, boardId)
          )
        )
        .pipe(Effect.asVoid);
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
    }: TPostCreate) => {
      const excerpt = htmlToExcerpt(content);

      return db
        .insert(postTable)
        .values({
          id,
          boardId,
          organizationId,
          title,
          content,
          excerpt,
          statusId,
          creatorId,
          creatorMemberId,
          createdAt: new Date(),
          slug: slugify(title),
          updatedAt: new Date(),
        })
        .pipe(Effect.asVoid);
    },
    merge: ({ organizationId, sourcePostId, targetPostId }: TPostMerge) =>
      Effect.promise(() =>
        db.transaction(async (tx) => {
          const posts = await tx
            .select({
              id: postTable.id,
              archivedAt: postTable.archivedAt,
              mergedIntoPostId: postTable.mergedIntoPostId,
            })
            .from(postTable)
            .where(
              and(
                inArray(postTable.id, [sourcePostId, targetPostId]),
                eq(postTable.organizationId, organizationId)
              )
            );
          const sourcePost = posts.find((post) => post.id === sourcePostId);
          const targetPost = posts.find((post) => post.id === targetPostId);

          if (
            !(sourcePost && targetPost) ||
            sourcePostId === targetPostId ||
            sourcePost.mergedIntoPostId ||
            sourcePost.archivedAt ||
            targetPost.mergedIntoPostId ||
            targetPost.archivedAt
          ) {
            return;
          }

          await tx
            .update(commentTable)
            .set({ postId: targetPostId })
            .where(eq(commentTable.postId, sourcePostId));

          const upvotes = await tx
            .select({
              id: upvoteTable.id,
              userId: upvoteTable.userId,
            })
            .from(upvoteTable)
            .where(eq(upvoteTable.postId, sourcePostId));

          for (const upvote of upvotes) {
            const existing = await tx
              .select({ id: upvoteTable.id })
              .from(upvoteTable)
              .where(
                and(
                  eq(upvoteTable.postId, targetPostId),
                  eq(upvoteTable.userId, upvote.userId)
                )
              )
              .limit(1);

            if (existing[0]) {
              await tx.delete(upvoteTable).where(eq(upvoteTable.id, upvote.id));
              continue;
            }

            await tx
              .update(upvoteTable)
              .set({ postId: targetPostId })
              .where(eq(upvoteTable.id, upvote.id));
          }

          const reactions = await tx
            .select({
              emoji: postReactionTable.emoji,
              id: postReactionTable.id,
              userId: postReactionTable.userId,
            })
            .from(postReactionTable)
            .where(eq(postReactionTable.postId, sourcePostId));

          for (const reaction of reactions) {
            const existing = await tx
              .select({ id: postReactionTable.id })
              .from(postReactionTable)
              .where(
                and(
                  eq(postReactionTable.postId, targetPostId),
                  eq(postReactionTable.userId, reaction.userId),
                  eq(postReactionTable.emoji, reaction.emoji)
                )
              )
              .limit(1);

            if (existing[0]) {
              await tx
                .delete(postReactionTable)
                .where(eq(postReactionTable.id, reaction.id));
              continue;
            }

            await tx
              .update(postReactionTable)
              .set({ postId: targetPostId })
              .where(eq(postReactionTable.id, reaction.id));
          }

          const postTags = await tx
            .select({
              id: postTagTable.id,
              tagId: postTagTable.tagId,
            })
            .from(postTagTable)
            .where(eq(postTagTable.postId, sourcePostId));

          for (const postTag of postTags) {
            const existing = await tx
              .select({ id: postTagTable.id })
              .from(postTagTable)
              .where(
                and(
                  eq(postTagTable.postId, targetPostId),
                  eq(postTagTable.tagId, postTag.tagId)
                )
              )
              .limit(1);

            if (existing[0]) {
              await tx
                .delete(postTagTable)
                .where(eq(postTagTable.id, postTag.id));
              continue;
            }

            await tx
              .update(postTagTable)
              .set({ postId: targetPostId })
              .where(eq(postTagTable.id, postTag.id));
          }

          await tx
            .update(postTable)
            .set({
              archivedAt: new Date(),
              mergedAt: new Date(),
              mergedIntoPostId: targetPostId,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(postTable.id, sourcePostId),
                eq(postTable.organizationId, organizationId)
              )
            );
        })
      ),
  };
});

export class PostRepository extends Effect.Service<PostRepository>()(
  "PostRepository",
  {
    effect: makePostRepository,
  }
) {
  static readonly layer = this.Default;
}
