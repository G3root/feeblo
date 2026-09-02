import { currentDb, schema } from "@feeblo/db";
import type { InsertComment } from "@feeblo/db/schema/feedback";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import * as EffectArray from "effect/Array";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

interface DeleteComment {
  id: string;
  organizationId: string;
  postId: string;
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

interface PinComment {
  id: string;
  organizationId: string;
  postId: string;
}

interface UnpinComment {
  id: string;
  organizationId: string;
  postId: string;
}

interface FindManyComments {
  organizationId: string;
  slug: string;
  visibility?: "PUBLIC" | "INTERNAL";
}

interface FindManyPublicComments {
  organizationId: string;
  slug: string;
  includeInternal?: boolean;
}
const makeCommentRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  return {
    findMany: ({ organizationId, slug, visibility }: FindManyComments) =>
      Effect.gen(function* () {
        const where: SQL[] = [];
        if (visibility) {
          where.push(eq(schema.commentTable.visibility, visibility));
        }

        where.push(eq(schema.commentTable.organizationId, organizationId));
        where.push(eq(schema.postTable.slug, slug));

        return yield* db
          .select({
            id: schema.commentTable.id,
            content: schema.commentTable.content,
            createdAt: schema.commentTable.createdAt,
            updatedAt: schema.commentTable.updatedAt,
            organizationId: schema.commentTable.organizationId,
            postId: schema.commentTable.postId,
            postSlug: schema.postTable.slug,
            userId: schema.commentTable.userId,
            visibility: schema.commentTable.visibility,
            parentCommentId: schema.commentTable.parentCommentId,
            memberId: schema.commentTable.memberId,
            pinnedAt: schema.commentTable.pinnedAt,
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
            eq(schema.commentTable.postId, schema.postTable.id)
          )
          .where(and(...where))
          .orderBy(
            sql`${schema.commentTable.pinnedAt} DESC NULLS LAST`,
            desc(schema.commentTable.createdAt)
          );
      }),
    findManyPublic: ({
      organizationId,
      slug,
      includeInternal = false,
    }: FindManyPublicComments) =>
      db
        .select({
          id: schema.commentTable.id,
          content: schema.commentTable.content,
          createdAt: schema.commentTable.createdAt,
          updatedAt: schema.commentTable.updatedAt,
          organizationId: schema.commentTable.organizationId,
          postId: schema.commentTable.postId,
          postSlug: schema.postTable.slug,
          userId: schema.commentTable.userId,
          visibility: schema.commentTable.visibility,
          parentCommentId: schema.commentTable.parentCommentId,
          memberId: schema.commentTable.memberId,
          pinnedAt: schema.commentTable.pinnedAt,
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
            eq(schema.postTable.slug, slug),
            ...(includeInternal
              ? []
              : [eq(schema.commentTable.visibility, "PUBLIC")]),
            eq(schema.boardTable.visibility, "PUBLIC")
          )
        )
        .orderBy(
          sql`${schema.commentTable.pinnedAt} DESC NULLS LAST`,
          desc(schema.commentTable.createdAt)
        ),
    create: (args: InsertComment) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        return yield* db
          .insert(schema.commentTable)
          .values({
            ...args,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .pipe(Effect.map(EffectArray.get(0)));
      }),
    delete: (args: DeleteComment) =>
      db
        .delete(schema.commentTable)
        .where(
          and(
            eq(schema.commentTable.id, args.id),
            eq(schema.commentTable.organizationId, args.organizationId),
            eq(schema.commentTable.postId, args.postId)
          )
        )
        .returning({
          id: schema.commentTable.id,
        })
        .pipe(Effect.map(EffectArray.get(0))),
    update: (args: UpdateComment) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        return yield* db
          .update(schema.commentTable)
          .set({
            content: args.content,
            updatedAt: now,
            ...(args.visibility && {
              visibility: args.visibility,
            }),
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
      db
        .select({
          id: schema.commentTable.id,
          visibility: schema.commentTable.visibility,
          pinnedAt: schema.commentTable.pinnedAt,
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
        .pipe(Effect.map(EffectArray.get(0))),
    pin: (args: PinComment) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        // Ensure target comment exists and belongs to this post/org before
        // clearing other pins - prevents accidental unpin when targeting a
        // non-existent comment.
        const target = yield* db
          .select({ id: schema.commentTable.id })
          .from(schema.commentTable)
          .where(
            and(
              eq(schema.commentTable.id, args.id),
              eq(schema.commentTable.organizationId, args.organizationId),
              eq(schema.commentTable.postId, args.postId)
            )
          )
          .pipe(Effect.map(EffectArray.get(0)));
        if (!target) {
          return undefined;
        }
        // Atomic single-statement pin: clears all other pins for this post
        // and pins the target. Using one UPDATE avoids the race where two
        // concurrent pins both clear then both pin, leaving two pinned rows.
        // The statement locks all rows for this post, so the second concurrent
        // pin will overwrite the first - last writer wins, exactly one pinned.
        yield* db.execute(
          sql`UPDATE "comment" SET "pinned_at" = CASE WHEN "id" = ${args.id} THEN ${now}::timestamptz ELSE NULL END, "updated_at" = CASE WHEN "id" = ${args.id} THEN ${now}::timestamptz ELSE "updated_at" END WHERE "organization_id" = ${args.organizationId} AND "post_id" = ${args.postId}`
        );
        return yield* db
          .select({
            id: schema.commentTable.id,
            pinnedAt: schema.commentTable.pinnedAt,
          })
          .from(schema.commentTable)
          .where(eq(schema.commentTable.id, args.id))
          .pipe(Effect.map(EffectArray.get(0)));
      }),
    unpin: (args: UnpinComment) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        return yield* db
          .update(schema.commentTable)
          .set({ pinnedAt: null, updatedAt: now })
          .where(
            and(
              eq(schema.commentTable.id, args.id),
              eq(schema.commentTable.organizationId, args.organizationId),
              eq(schema.commentTable.postId, args.postId)
            )
          )
          .returning()
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
