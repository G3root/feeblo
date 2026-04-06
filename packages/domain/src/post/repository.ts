import { DB } from "@feeblo/db";
import { user as userTable } from "@feeblo/db/schema/auth";
import { post as postTable, upvote as upvoteTable } from "@feeblo/db/schema/feedback";
import { slugify } from "@feeblo/utils/url";
import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import { Effect, Array as EffectArray } from "effect";
import type { TPostUpdate } from "./schema";

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

type TPostFindByCreatorId = {
  id: string;
  organizationId: string;
  memberId: string;
  boardId: string;
};

type TPostFindByCreatorIds = {
  ids: readonly string[];
  organizationId: string;
  memberId: string;
  boardId: string;
};

export class PostRepository extends Effect.Service<PostRepository>()(
  "PostRepository",
  {
    effect: Effect.gen(function* () {
      const db = yield* DB;

      return {
        findByCreatorId: ({
          id,
          organizationId,
          memberId,
          boardId,
        }: TPostFindByCreatorId) => {
          return db
            .select({ id: postTable.id })
            .from(postTable)
            .where(
              and(
                eq(postTable.id, id),
                eq(postTable.organizationId, organizationId),
                eq(postTable.creatorMemberId, memberId),
                eq(postTable.boardId, boardId)
              )
            )
            .pipe(Effect.map(EffectArray.get(0)));
        },
        findByCreatorIds: ({
          ids,
          organizationId,
          memberId,
          boardId,
        }: TPostFindByCreatorIds) => {
          return db
            .select({ id: postTable.id })
            .from(postTable)
            .where(
              and(
                inArray(postTable.id, ids),
                eq(postTable.organizationId, organizationId),
                eq(postTable.creatorMemberId, memberId),
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

          return db
            .select({
              id: postTable.id,
              title: postTable.title,
              boardId: postTable.boardId,
              slug: postTable.slug,
              content: postTable.content,
              upVotes: sql<number>`coalesce(${upvoteCounts.upVotes}, 0)`,
              statusId: postTable.statusId,
              createdAt: postTable.createdAt,
              updatedAt: postTable.updatedAt,
              organizationId: postTable.organizationId,
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
            .set({ statusId, boardId, title, content })
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
        }: TPostCreate) =>
          db
            .insert(postTable)
            .values({
              id,
              boardId,
              organizationId,
              title,
              content,
              statusId,
              creatorId,
              creatorMemberId,
              createdAt: new Date(),
              slug: slugify(title),
              updatedAt: new Date(),
            })
            .pipe(Effect.asVoid),
      };
    }),
  }
) {}
