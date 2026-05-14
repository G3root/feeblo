/** biome-ignore-all lint/style/noNestedTernary: <explanation> */
import { Database, schema } from "@feeblo/db";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { slugify } from "@feeblo/utils/url";
import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import { Context, Effect, Array as EffectArray, Layer, Option } from "effect";
import type { TPostAdminUpdate, TPostUpdate } from "./schema";

interface TPostFindMany {
  boardId?: string | null | undefined;
  organizationId: string;
  userId?: string | null | undefined;
}

interface TPostDelete {
  boardId: string;
  id: string | readonly string[];
  organizationId: string;
}

interface TPostCreate {
  boardId: string;
  content: string;
  creatorId: string;
  creatorMemberId?: string;
  id: string;
  organizationId: string;
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

interface TPostFindManyQuery {
  userId?: string | null | undefined;
  whereClause: SQL | undefined;
}

interface TPostById {
  id: string;
  organizationId: string;
}

interface TPostDeleteQuery {
  boardId: string;
  organizationId: string;
  where: SQL[];
}

interface TPostCreateInternal extends TPostCreate {
  excerpt: string;
}

interface TMoveCommentsToMergedPost {
  sourcePostId: string;
  targetPostId: string;
}

interface TSelectMergedUpvotes {
  sourcePostId: string;
}

interface TFindExistingMergedUpvote {
  targetPostId: string;
  userId: string;
}

interface TDeleteMergedUpvote {
  id: string;
}

interface TMoveUpvoteToMergedPost {
  id: string;
  targetPostId: string;
}

interface TSelectMergedReactions {
  sourcePostId: string;
}

interface TFindExistingMergedReaction {
  emoji: string;
  targetPostId: string;
  userId: string;
}

interface TDeleteMergedReaction {
  id: string;
}

interface TMoveReactionToMergedPost {
  id: string;
  targetPostId: string;
}

interface TSelectMergedPostTags {
  sourcePostId: string;
}

interface TFindExistingMergedPostTag {
  tagId: string;
  targetPostId: string;
}

interface TDeleteMergedPostTag {
  id: string;
}

interface TMovePostTagToMergedPost {
  id: string;
  targetPostId: string;
}

interface TArchiveMergedSourcePost {
  organizationId: string;
  sourcePostId: string;
  targetPostId: string;
}

const getWhereClause = (where: SQL[]) =>
  where.length > 1
    ? and(...where)
    : Option.match(EffectArray.get(0)(where), {
        onNone: () => undefined,
        onSome: (clause) => clause,
      });

const createHasUserUpVotedExpr = (userId?: string | null) =>
  userId
    ? sql<boolean>`exists(select 1 from ${schema.upvoteTable} where ${schema.upvoteTable.postId} = ${schema.postTable.id} and ${schema.upvoteTable.userId} = ${userId})`
    : sql<boolean>`false`;

const excerptExpr = sql<string>`coalesce(nullif(${schema.postTable.excerpt}, ''), trim(regexp_replace(regexp_replace(${schema.postTable.content}, '<[^>]+>', ' ', 'gi'), '\\s+', ' ', 'g')))`;

const selectPostFields = (userId?: string | null) => ({
  id: schema.postTable.id,
  title: schema.postTable.title,
  boardId: schema.postTable.boardId,
  slug: schema.postTable.slug,
  content: schema.postTable.content,
  excerpt: excerptExpr,
  upVotes: sql<number>`coalesce((select count(*)::int from ${schema.upvoteTable} where ${schema.upvoteTable.postId} = ${schema.postTable.id}), 0)`,
  statusId: schema.postTable.statusId,
  createdAt: schema.postTable.createdAt,
  updatedAt: schema.postTable.updatedAt,
  organizationId: schema.postTable.organizationId,
  user: {
    name: sql<string | null>`${schema.userTable.name}`,
    image: sql<string | null>`${schema.userTable.image}`,
  },
  hasUserUpVoted: createHasUserUpVotedExpr(userId),
  creatorMemberId: schema.postTable.creatorMemberId,
  creatorId: schema.postTable.creatorId,
  lockedAt: schema.postTable.lockedAt,
  archivedAt: schema.postTable.archivedAt,
  mergedIntoPostId: schema.postTable.mergedIntoPostId,
  mergedAt: schema.postTable.mergedAt,
});

const makePostRepository = Effect.gen(function* () {
  const db = yield* Database.Database;

  return {
    findByCreatorId: ({
      id,
      organizationId,
      userId,
      boardId,
    }: TPostFindByCreatorId) =>
      db
        .makeQuery((execute, input: TPostFindByCreatorId) =>
          execute((client) =>
            client
              .select({ id: schema.postTable.id })
              .from(schema.postTable)
              .where(
                and(
                  eq(schema.postTable.id, input.id),
                  eq(schema.postTable.organizationId, input.organizationId),
                  eq(schema.postTable.creatorId, input.userId),
                  eq(schema.postTable.boardId, input.boardId)
                )
              )
          )
        )({ id, organizationId, userId, boardId })
        .pipe(Effect.map(EffectArray.get(0))),

    findByCreatorIds: ({
      ids,
      organizationId,
      userId,
      boardId,
    }: TPostFindByCreatorIds) =>
      db.makeQuery((execute, input: TPostFindByCreatorIds) =>
        execute((client) =>
          client
            .select({ id: schema.postTable.id })
            .from(schema.postTable)
            .where(
              and(
                inArray(schema.postTable.id, input.ids),
                eq(schema.postTable.organizationId, input.organizationId),
                eq(schema.postTable.creatorId, input.userId),
                eq(schema.postTable.boardId, input.boardId)
              )
            )
        )
      )({ ids, organizationId, userId, boardId }),

    findMany: ({ boardId, organizationId, userId }: TPostFindMany) => {
      const where: SQL[] = [];
      if (boardId) {
        where.push(eq(schema.postTable.boardId, boardId));
      }

      where.push(eq(schema.postTable.organizationId, organizationId));
      const whereClause = getWhereClause(where);

      return db.makeQuery((execute, input: TPostFindManyQuery) =>
        execute((client) =>
          client
            .select(selectPostFields(input.userId))
            .from(schema.postTable)
            .leftJoin(
              schema.userTable,
              eq(schema.userTable.id, schema.postTable.creatorId)
            )
            .where(input.whereClause)
        )
      )({ whereClause, userId });
    },

    findManyPublic: ({ boardId, organizationId, userId }: TPostFindMany) => {
      const where: SQL[] = [
        eq(schema.postTable.organizationId, organizationId),
      ];
      if (boardId) {
        where.push(eq(schema.postTable.boardId, boardId));
      }
      where.push(eq(schema.boardTable.visibility, "PUBLIC"));

      const whereClause = and(...where);

      return db.makeQuery((execute, input: TPostFindManyQuery) =>
        execute((client) =>
          client
            .select(selectPostFields(input.userId))
            .from(schema.postTable)
            .innerJoin(
              schema.boardTable,
              eq(schema.boardTable.id, schema.postTable.boardId)
            )
            .leftJoin(
              schema.userTable,
              eq(schema.userTable.id, schema.postTable.creatorId)
            )
            .where(input.whereClause)
        )
      )({ whereClause, userId });
    },

    isPublicPost: ({ id, organizationId }: TPostById) =>
      db
        .makeQuery((execute, input: TPostById) =>
          execute((client) =>
            client
              .select({ id: schema.postTable.id })
              .from(schema.postTable)
              .innerJoin(
                schema.boardTable,
                eq(schema.boardTable.id, schema.postTable.boardId)
              )
              .where(
                and(
                  eq(schema.postTable.id, input.id),
                  eq(schema.postTable.organizationId, input.organizationId),
                  eq(schema.boardTable.visibility, "PUBLIC")
                )
              )
          )
        )({ id, organizationId })
        .pipe(Effect.map((rows) => rows.length > 0)),

    isUnlocked: ({ id, organizationId }: TPostById) =>
      db
        .makeQuery((execute, input: TPostById) =>
          execute((client) =>
            client
              .select({ id: schema.postTable.id })
              .from(schema.postTable)
              .where(
                and(
                  eq(schema.postTable.id, input.id),
                  eq(schema.postTable.organizationId, input.organizationId),
                  sql`${schema.postTable.lockedAt} is null`
                )
              )
          )
        )({ id, organizationId })
        .pipe(Effect.map((rows) => rows.length > 0)),

    isUnlockedPublic: ({ id, organizationId }: TPostById) =>
      db
        .makeQuery((execute, input: TPostById) =>
          execute((client) =>
            client
              .select({ id: schema.postTable.id })
              .from(schema.postTable)
              .innerJoin(
                schema.boardTable,
                eq(schema.boardTable.id, schema.postTable.boardId)
              )
              .where(
                and(
                  eq(schema.postTable.id, input.id),
                  eq(schema.postTable.organizationId, input.organizationId),
                  eq(schema.boardTable.visibility, "PUBLIC"),
                  sql`${schema.postTable.lockedAt} is null`
                )
              )
          )
        )({ id, organizationId })
        .pipe(Effect.map((rows) => rows.length > 0)),

    update: ({
      id,
      organizationId,
      statusId,
      boardId,
      title,
      content,
    }: TPostUpdate) =>
      db
        .makeQuery((execute, input: TPostUpdate) =>
          execute((client) =>
            client
              .update(schema.postTable)
              .set({
                statusId: input.statusId,
                boardId: input.boardId,
                title: input.title,
                content: input.content,
                excerpt: htmlToExcerpt(input.content),
              })
              .where(
                and(
                  eq(schema.postTable.id, input.id),
                  eq(schema.postTable.organizationId, input.organizationId)
                )
              )
          )
        )({ id, organizationId, statusId, boardId, title, content })
        .pipe(Effect.asVoid),

    adminUpdate: ({ id, organizationId, archived, locked }: TPostAdminUpdate) =>
      db
        .makeQuery((execute, input: TPostAdminUpdate) =>
          execute((client) =>
            client
              .update(schema.postTable)
              .set({
                archivedAt:
                  input.archived === undefined
                    ? undefined
                    : input.archived
                      ? new Date()
                      : null,
                lockedAt:
                  input.locked === undefined
                    ? undefined
                    : input.locked
                      ? new Date()
                      : null,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(schema.postTable.id, input.id),
                  eq(schema.postTable.organizationId, input.organizationId)
                )
              )
          )
        )({ id, organizationId, archived, locked })
        .pipe(Effect.asVoid),

    delete: ({ id, organizationId, boardId }: TPostDelete) => {
      const where: SQL[] = [];

      if (typeof id === "string") {
        where.push(eq(schema.postTable.id, id));
      } else {
        where.push(inArray(schema.postTable.id, id));
      }

      return db
        .makeQuery((execute, input: TPostDeleteQuery) =>
          execute((client) =>
            client
              .delete(schema.postTable)
              .where(
                and(
                  ...input.where,
                  eq(schema.postTable.organizationId, input.organizationId),
                  eq(schema.postTable.boardId, input.boardId)
                )
              )
          )
        )({ where, organizationId, boardId })
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
        .makeQuery((execute, input: TPostCreateInternal) =>
          execute((client) =>
            client.insert(schema.postTable).values({
              id: input.id,
              boardId: input.boardId,
              organizationId: input.organizationId,
              title: input.title,
              content: input.content,
              excerpt: input.excerpt,
              statusId: input.statusId,
              creatorId: input.creatorId,
              ...(input.creatorMemberId
                ? { creatorMemberId: input.creatorMemberId }
                : {}),
              createdAt: new Date(),
              slug: slugify(input.title),
              updatedAt: new Date(),
            })
          )
        )(
          creatorMemberId
            ? {
                id,
                boardId,
                organizationId,
                title,
                content,
                statusId,
                creatorId,
                creatorMemberId,
                excerpt,
              }
            : {
                id,
                boardId,
                organizationId,
                title,
                content,
                statusId,
                creatorId,
                excerpt,
              }
        )
        .pipe(Effect.asVoid);
    },

    merge: ({ organizationId, sourcePostId, targetPostId }: TPostMerge) =>
      db.transaction(
        Effect.gen(function* () {
          const posts = yield* db.makeQuery((execute, input: TPostMerge) =>
            execute((client) =>
              client
                .select({
                  id: schema.postTable.id,
                  archivedAt: schema.postTable.archivedAt,
                  mergedIntoPostId: schema.postTable.mergedIntoPostId,
                })
                .from(schema.postTable)
                .where(
                  and(
                    inArray(schema.postTable.id, [
                      input.sourcePostId,
                      input.targetPostId,
                    ]),
                    eq(schema.postTable.organizationId, input.organizationId)
                  )
                )
            )
          )({ organizationId, sourcePostId, targetPostId });

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

          yield* db.makeQuery((execute, input: TMoveCommentsToMergedPost) =>
            execute((client) =>
              client
                .update(schema.commentTable)
                .set({ postId: input.targetPostId })
                .where(eq(schema.commentTable.postId, input.sourcePostId))
            )
          )({ sourcePostId, targetPostId });

          const upvotes = yield* db.makeQuery(
            (execute, input: TSelectMergedUpvotes) =>
              execute((client) =>
                client
                  .select({
                    id: schema.upvoteTable.id,
                    userId: schema.upvoteTable.userId,
                  })
                  .from(schema.upvoteTable)
                  .where(eq(schema.upvoteTable.postId, input.sourcePostId))
              )
          )({ sourcePostId });

          for (const upvote of upvotes) {
            const existing = yield* db
              .makeQuery((execute, input: TFindExistingMergedUpvote) =>
                execute((client) =>
                  client
                    .select({ id: schema.upvoteTable.id })
                    .from(schema.upvoteTable)
                    .where(
                      and(
                        eq(schema.upvoteTable.postId, input.targetPostId),
                        eq(schema.upvoteTable.userId, input.userId)
                      )
                    )
                    .limit(1)
                )
              )({ targetPostId, userId: upvote.userId })
              .pipe(Effect.map(EffectArray.get(0)));

            if (Option.isSome(existing)) {
              yield* db.makeQuery((execute, input: TDeleteMergedUpvote) =>
                execute((client) =>
                  client
                    .delete(schema.upvoteTable)
                    .where(eq(schema.upvoteTable.id, input.id))
                )
              )({ id: upvote.id });
              continue;
            }

            yield* db.makeQuery((execute, input: TMoveUpvoteToMergedPost) =>
              execute((client) =>
                client
                  .update(schema.upvoteTable)
                  .set({ postId: input.targetPostId })
                  .where(eq(schema.upvoteTable.id, input.id))
              )
            )({ id: upvote.id, targetPostId });
          }

          const reactions = yield* db.makeQuery(
            (execute, input: TSelectMergedReactions) =>
              execute((client) =>
                client
                  .select({
                    emoji: schema.postReactionTable.emoji,
                    id: schema.postReactionTable.id,
                    userId: schema.postReactionTable.userId,
                  })
                  .from(schema.postReactionTable)
                  .where(
                    eq(schema.postReactionTable.postId, input.sourcePostId)
                  )
              )
          )({ sourcePostId });

          for (const reaction of reactions) {
            const existing = yield* db
              .makeQuery((execute, input: TFindExistingMergedReaction) =>
                execute((client) =>
                  client
                    .select({ id: schema.postReactionTable.id })
                    .from(schema.postReactionTable)
                    .where(
                      and(
                        eq(schema.postReactionTable.postId, input.targetPostId),
                        eq(schema.postReactionTable.userId, input.userId),
                        eq(schema.postReactionTable.emoji, input.emoji)
                      )
                    )
                    .limit(1)
                )
              )({
                targetPostId,
                userId: reaction.userId,
                emoji: reaction.emoji,
              })
              .pipe(Effect.map(EffectArray.get(0)));

            if (Option.isSome(existing)) {
              yield* db.makeQuery((execute, input: TDeleteMergedReaction) =>
                execute((client) =>
                  client
                    .delete(schema.postReactionTable)
                    .where(eq(schema.postReactionTable.id, input.id))
                )
              )({ id: reaction.id });
              continue;
            }

            yield* db.makeQuery((execute, input: TMoveReactionToMergedPost) =>
              execute((client) =>
                client
                  .update(schema.postReactionTable)
                  .set({ postId: input.targetPostId })
                  .where(eq(schema.postReactionTable.id, input.id))
              )
            )({ id: reaction.id, targetPostId });
          }

          const postTags = yield* db.makeQuery(
            (execute, input: TSelectMergedPostTags) =>
              execute((client) =>
                client
                  .select({
                    id: schema.postTagTable.id,
                    tagId: schema.postTagTable.tagId,
                  })
                  .from(schema.postTagTable)
                  .where(eq(schema.postTagTable.postId, input.sourcePostId))
              )
          )({ sourcePostId });

          for (const postTag of postTags) {
            const existing = yield* db
              .makeQuery((execute, input: TFindExistingMergedPostTag) =>
                execute((client) =>
                  client
                    .select({ id: schema.postTagTable.id })
                    .from(schema.postTagTable)
                    .where(
                      and(
                        eq(schema.postTagTable.postId, input.targetPostId),
                        eq(schema.postTagTable.tagId, input.tagId)
                      )
                    )
                    .limit(1)
                )
              )({ targetPostId, tagId: postTag.tagId })
              .pipe(Effect.map(EffectArray.get(0)));

            if (Option.isSome(existing)) {
              yield* db.makeQuery((execute, input: TDeleteMergedPostTag) =>
                execute((client) =>
                  client
                    .delete(schema.postTagTable)
                    .where(eq(schema.postTagTable.id, input.id))
                )
              )({ id: postTag.id });
              continue;
            }

            yield* db.makeQuery((execute, input: TMovePostTagToMergedPost) =>
              execute((client) =>
                client
                  .update(schema.postTagTable)
                  .set({ postId: input.targetPostId })
                  .where(eq(schema.postTagTable.id, input.id))
              )
            )({ id: postTag.id, targetPostId });
          }

          yield* db.makeQuery((execute, input: TArchiveMergedSourcePost) =>
            execute((client) =>
              client
                .update(schema.postTable)
                .set({
                  archivedAt: new Date(),
                  mergedAt: new Date(),
                  mergedIntoPostId: input.targetPostId,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(schema.postTable.id, input.sourcePostId),
                    eq(schema.postTable.organizationId, input.organizationId)
                  )
                )
            )
          )({ organizationId, sourcePostId, targetPostId });
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
