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
        where.push(eq(schema.commentTable.visibility, visibility));
      }

      where.push(eq(schema.commentTable.organizationId, organizationId));
      where.push(eq(schema.commentTable.postId, postId));

      return db.makeQuery((execute, input: FindManyWhere) =>
        execute((client) =>
          client
            .select({
              id: schema.commentTable.id,
              content: schema.commentTable.content,
              createdAt: schema.commentTable.createdAt,
              updatedAt: schema.commentTable.updatedAt,
              organizationId: schema.commentTable.organizationId,
              postId: schema.commentTable.postId,
              userId: schema.commentTable.userId,
              visibility: schema.commentTable.visibility,
              parentCommentId: schema.commentTable.parentCommentId,
              memberId: schema.commentTable.memberId,
              user: {
                name: schema.userTable.name,
              },
            })
            .from(schema.commentTable)
            .innerJoin(
              schema.userTable,
              eq(schema.commentTable.userId, schema.userTable.id)
            )
            .where(and(...input.where))
        )
      )({ where });
    },
    findManyPublic: (args: FindManyPublicComments) =>
      db.makeQuery((execute, input: FindManyPublicComments) =>
        execute((client) =>
          client
            .select({
              id: schema.commentTable.id,
              content: schema.commentTable.content,
              createdAt: schema.commentTable.createdAt,
              updatedAt: schema.commentTable.updatedAt,
              organizationId: schema.commentTable.organizationId,
              postId: schema.commentTable.postId,
              userId: schema.commentTable.userId,
              visibility: schema.commentTable.visibility,
              parentCommentId: schema.commentTable.parentCommentId,
              memberId: schema.commentTable.memberId,
              user: {
                name: schema.userTable.name,
              },
            })
            .from(schema.commentTable)
            .innerJoin(
              schema.userTable,
              eq(schema.commentTable.userId, schema.userTable.id)
            )
            .innerJoin(
              schema.postTable,
              eq(schema.postTable.id, schema.commentTable.postId)
            )
            .innerJoin(
              schema.boardTable,
              eq(schema.boardTable.id, schema.postTable.boardId)
            )
            .where(
              and(
                eq(schema.commentTable.organizationId, input.organizationId),
                eq(schema.commentTable.postId, input.postId),
                eq(schema.commentTable.visibility, "PUBLIC"),
                eq(schema.boardTable.visibility, "PUBLIC")
              )
            )
        )
      )(args),
    create: (args: InsertComment) =>
      db
        .makeQuery((execute, input: InsertComment) =>
          execute((client) =>
            client
              .insert(schema.commentTable)
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
              .delete(schema.commentTable)
              .where(
                and(
                  eq(schema.commentTable.id, input.id),
                  eq(schema.commentTable.organizationId, input.organizationId),
                  eq(schema.commentTable.postId, input.postId),
                  eq(schema.commentTable.userId, input.userId)
                )
              )
              .returning({
                id: schema.commentTable.id,
              })
          )
        )(args)
        .pipe(Effect.map(EffectArray.get(0))),
    update: (args: UpdateComment) =>
      db
        .makeQuery((execute, input: UpdateComment) =>
          execute((client) =>
            client
              .update(schema.commentTable)
              .set({
                content: input.content,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(schema.commentTable.id, input.id),
                  eq(schema.commentTable.organizationId, input.organizationId),
                  eq(schema.commentTable.postId, input.postId),
                  eq(schema.commentTable.userId, input.userId)
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
                id: schema.commentTable.id,
              })
              .from(schema.commentTable)
              .where(
                and(
                  eq(schema.commentTable.id, input.id),
                  eq(schema.commentTable.organizationId, input.organizationId),
                  eq(schema.commentTable.postId, input.postId),
                  ...(input.userId
                    ? [eq(schema.commentTable.userId, input.userId)]
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
