import { Database, schema } from "@feeblo/db";
import type { InsertComment } from "@feeblo/db/schema/feedback";
import { and, eq, type SQL } from "drizzle-orm";
import { Context, Effect, Array as EffectArray, Layer } from "effect";

interface DeleteComment {
  id: string;
  organizationId: string;
  postId: string;
  userId: string;
}

interface UpdateComment {
  content: string;
  id: string;
  organizationId: string;
  postId: string;
  userId: string;
}

interface FindByIdComment {
  id: string;
  organizationId: string;
  postId: string;
  userId?: string;
}

interface FindManyComments {
  organizationId: string;
  postId: string;
  visibility?: "PUBLIC" | "INTERNAL";
}

interface FindManyWhere {
  where: SQL[];
}

interface FindManyPublicComments {
  organizationId: string;
  postId: string;
}
const makeCommentRepository = Effect.gen(function* () {
  const db = yield* Database.Database;

  return {
    findMany: ({ organizationId, postId, visibility }: FindManyComments) => {
      const where: SQL[] = [];
      if (visibility) {
        where.push(eq(schema.comment.visibility, visibility));
      }

      where.push(eq(schema.comment.organizationId, organizationId));
      where.push(eq(schema.comment.postId, postId));

      return db.makeQuery((execute, input: FindManyWhere) =>
        execute((client) =>
          client
            .select({
              id: schema.comment.id,
              content: schema.comment.content,
              createdAt: schema.comment.createdAt,
              updatedAt: schema.comment.updatedAt,
              organizationId: schema.comment.organizationId,
              postId: schema.comment.postId,
              userId: schema.comment.userId,
              visibility: schema.comment.visibility,
              parentCommentId: schema.comment.parentCommentId,
              memberId: schema.comment.memberId,
              user: {
                name: schema.user.name,
              },
            })
            .from(schema.comment)
            .innerJoin(schema.user, eq(schema.comment.userId, schema.user.id))
            .where(and(...input.where))
        )
      )({ where });
    },
    findManyPublic: (args: FindManyPublicComments) =>
      db.makeQuery((execute, input: FindManyPublicComments) =>
        execute((client) =>
          client
            .select({
              id: schema.comment.id,
              content: schema.comment.content,
              createdAt: schema.comment.createdAt,
              updatedAt: schema.comment.updatedAt,
              organizationId: schema.comment.organizationId,
              postId: schema.comment.postId,
              userId: schema.comment.userId,
              visibility: schema.comment.visibility,
              parentCommentId: schema.comment.parentCommentId,
              memberId: schema.comment.memberId,
              user: {
                name: schema.user.name,
              },
            })
            .from(schema.comment)
            .innerJoin(schema.user, eq(schema.comment.userId, schema.user.id))
            .innerJoin(schema.post, eq(schema.post.id, schema.comment.postId))
            .innerJoin(schema.board, eq(schema.board.id, schema.post.boardId))
            .where(
              and(
                eq(schema.comment.organizationId, input.organizationId),
                eq(schema.comment.postId, input.postId),
                eq(schema.comment.visibility, "PUBLIC"),
                eq(schema.board.visibility, "PUBLIC")
              )
            )
        )
      )(args),
    create: (args: InsertComment) =>
      db
        .makeQuery((execute, input: InsertComment) =>
          execute((client) =>
            client
              .insert(schema.comment)
              .values({
                ...input,
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              .returning()
          )
        )(args)
        .pipe(Effect.map(EffectArray.get(0))),
    delete: (args: DeleteComment) =>
      db
        .makeQuery((execute, input: DeleteComment) =>
          execute((client) =>
            client
              .delete(schema.comment)
              .where(
                and(
                  eq(schema.comment.id, input.id),
                  eq(schema.comment.organizationId, input.organizationId),
                  eq(schema.comment.postId, input.postId),
                  eq(schema.comment.userId, input.userId)
                )
              )
              .returning({
                id: schema.comment.id,
              })
          )
        )(args)
        .pipe(Effect.map(EffectArray.get(0))),
    update: (args: UpdateComment) =>
      db
        .makeQuery((execute, input: UpdateComment) =>
          execute((client) =>
            client
              .update(schema.comment)
              .set({
                content: input.content,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(schema.comment.id, input.id),
                  eq(schema.comment.organizationId, input.organizationId),
                  eq(schema.comment.postId, input.postId),
                  eq(schema.comment.userId, input.userId)
                )
              )
              .returning()
          )
        )(args)
        .pipe(Effect.map(EffectArray.get(0))),
    findById: (args: FindByIdComment) =>
      db
        .makeQuery((execute, input: FindByIdComment) =>
          execute((client) =>
            client
              .select({
                id: schema.comment.id,
              })
              .from(schema.comment)
              .where(
                and(
                  eq(schema.comment.id, input.id),
                  eq(schema.comment.organizationId, input.organizationId),
                  eq(schema.comment.postId, input.postId),
                  ...(input.userId
                    ? [eq(schema.comment.userId, input.userId)]
                    : [])
                )
              )
          )
        )(args)
        .pipe(Effect.map(EffectArray.get(0))),
  };
});

export class CommentRepository extends Context.Service<CommentRepository>()(
  "CommentRepository",
  {
    make: makeCommentRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
