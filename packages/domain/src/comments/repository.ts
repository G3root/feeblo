import { currentDb, schema } from "@feeblo/db";
import type { InsertComment } from "@feeblo/db/schema/feedback";
import { and, eq, type SQL } from "drizzle-orm";
import * as EffectArray from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

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
  visibility?: "PUBLIC" | "INTERNAL";
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

interface FindManyPublicComments {
  organizationId: string;
  postId: string;
}
const makeCommentRepository = Effect.gen(function* () {
  return {
    findMany: ({ organizationId, postId, visibility }: FindManyComments) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const where: SQL[] = [];
        if (visibility) {
          where.push(eq(schema.commentTable.visibility, visibility));
        }

        where.push(eq(schema.commentTable.organizationId, organizationId));
        where.push(eq(schema.commentTable.postId, postId));

        return yield* db
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
          .where(and(...where));
      }),
    findManyPublic: ({ organizationId, postId }: FindManyPublicComments) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
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
              eq(schema.commentTable.organizationId, organizationId),
              eq(schema.commentTable.postId, postId),
              eq(schema.commentTable.visibility, "PUBLIC"),
              eq(schema.boardTable.visibility, "PUBLIC")
            )
          );
      }),
    create: (args: InsertComment) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .insert(schema.commentTable)
          .values({
            ...args,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning()
          .pipe(Effect.map(EffectArray.get(0)));
      }),
    delete: (args: DeleteComment) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .delete(schema.commentTable)
          .where(
            and(
              eq(schema.commentTable.id, args.id),
              eq(schema.commentTable.organizationId, args.organizationId),
              eq(schema.commentTable.postId, args.postId),
              eq(schema.commentTable.userId, args.userId)
            )
          )
          .returning({
            id: schema.commentTable.id,
          })
          .pipe(Effect.map(EffectArray.get(0)));
      }),
    update: (args: UpdateComment) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .update(schema.commentTable)
          .set({
            content: args.content,
            updatedAt: new Date(),
            ...(args.visibility
              ? {
                  visibility: args.visibility,
                }
              : {}),
          })
          .where(
            and(
              eq(schema.commentTable.id, args.id),
              eq(schema.commentTable.organizationId, args.organizationId),
              eq(schema.commentTable.postId, args.postId),
              eq(schema.commentTable.userId, args.userId)
            )
          )
          .returning()
          .pipe(Effect.map(EffectArray.get(0)));
      }),
    findById: (args: FindByIdComment) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .select({
            id: schema.commentTable.id,
            visibility: schema.commentTable.visibility,
          })
          .from(schema.commentTable)
          .where(
            and(
              eq(schema.commentTable.id, args.id),
              eq(schema.commentTable.organizationId, args.organizationId),
              eq(schema.commentTable.postId, args.postId),
              ...(args.userId
                ? [eq(schema.commentTable.userId, args.userId)]
                : [])
            )
          )
          .pipe(Effect.map(EffectArray.get(0)));
      }),
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
