import { Database, schema } from "@feeblo/db";
import { generateId } from "@feeblo/utils/id";
import { and, eq, type SQL } from "drizzle-orm";
import { Context, Effect, Array as EffectArray, Layer, Option } from "effect";

interface TUpvoteList {
  organizationId: string;
  postId: string;
  visibility?: "PUBLIC" | "PRIVATE";
}

interface TUpvoteToggle {
  organizationId: string;
  postId: string;
  userId: string;
  visibility?: "PUBLIC" | "PRIVATE";
}

interface TOperatorsQuery {
  operators: SQL[];
}

interface TFindExistingUpvote {
  postId: string;
  userId: string;
}

interface TDeleteUpvote {
  id: string;
}

interface TFindMember {
  organizationId: string;
  userId: string;
}

interface TCreateUpvote {
  memberId: string | null;
  postId: string;
  userId: string;
}

const makeUpvoteRepository = Effect.gen(function* () {
  const db = yield* Database.Database;

  return {
    list: ({ postId, organizationId, visibility }: TUpvoteList) =>
      Effect.gen(function* () {
        const operators = [
          eq(schema.postTable.id, postId),
          eq(schema.postTable.organizationId, organizationId),
          ...(visibility ? [eq(schema.boardTable.visibility, visibility)] : []),
        ];
        const post = yield* db
          .makeQuery((execute, input: TOperatorsQuery) =>
            execute((client) =>
              client
                .select({ id: schema.postTable.id })
                .from(schema.postTable)
                .innerJoin(
                  schema.boardTable,
                  eq(schema.boardTable.id, schema.postTable.boardId)
                )
                .where(and(...input.operators))
                .limit(1)
            )
          )({ operators })
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isNone(post)) {
          return [];
        }

        return yield* db.makeQuery((execute, input: TUpvoteList) =>
          execute((client) =>
            client
              .select({
                id: schema.upvoteTable.id,
                postId: schema.upvoteTable.postId,
                organizationId: schema.postTable.organizationId,
                userId: schema.upvoteTable.userId,
                user: {
                  name: schema.userTable.name,
                  image: schema.userTable.image,
                },
                memberId: schema.upvoteTable.memberId,
                createdAt: schema.upvoteTable.createdAt,
                updatedAt: schema.upvoteTable.updatedAt,
              })
              .from(schema.upvoteTable)
              .innerJoin(
                schema.postTable,
                eq(schema.postTable.id, schema.upvoteTable.postId)
              )
              .innerJoin(
                schema.userTable,
                eq(schema.userTable.id, schema.upvoteTable.userId)
              )
              .where(
                and(
                  eq(schema.postTable.organizationId, input.organizationId),
                  eq(schema.upvoteTable.postId, input.postId)
                )
              )
          )
        )(
          visibility
            ? { postId, organizationId, visibility }
            : { postId, organizationId }
        );
      }),

    toggle: ({ organizationId, postId, userId, visibility }: TUpvoteToggle) =>
      Effect.gen(function* () {
        const operators = [
          eq(schema.postTable.id, postId),
          eq(schema.postTable.organizationId, organizationId),
          ...(visibility ? [eq(schema.boardTable.visibility, visibility)] : []),
        ];
        const post = yield* db
          .makeQuery((execute, input: TOperatorsQuery) =>
            execute((client) =>
              client
                .select({ id: schema.postTable.id })
                .from(schema.postTable)
                .innerJoin(
                  schema.boardTable,
                  eq(schema.boardTable.id, schema.postTable.boardId)
                )
                .where(and(...input.operators))
                .limit(1)
            )
          )({ operators })
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isNone(post)) {
          return { upvoted: false };
        }

        const existingUpvote = yield* db
          .makeQuery((execute, input: TFindExistingUpvote) =>
            execute((client) =>
              client
                .select({ id: schema.upvoteTable.id })
                .from(schema.upvoteTable)
                .where(
                  and(
                    eq(schema.upvoteTable.postId, input.postId),
                    eq(schema.upvoteTable.userId, input.userId)
                  )
                )
                .limit(1)
            )
          )({ postId, userId })
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isSome(existingUpvote)) {
          yield* db.makeQuery((execute, input: TDeleteUpvote) =>
            execute((client) =>
              client
                .delete(schema.upvoteTable)
                .where(eq(schema.upvoteTable.id, input.id))
            )
          )({ id: existingUpvote.value.id });

          return { upvoted: false };
        }

        const member = yield* db
          .makeQuery((execute, input: TFindMember) =>
            execute((client) =>
              client
                .select({ id: schema.memberTable.id })
                .from(schema.memberTable)
                .where(
                  and(
                    eq(schema.memberTable.organizationId, input.organizationId),
                    eq(schema.memberTable.userId, input.userId)
                  )
                )
                .limit(1)
            )
          )({ organizationId, userId })
          .pipe(Effect.map(EffectArray.get(0)));

        yield* db.makeQuery((execute, input: TCreateUpvote) =>
          execute((client) =>
            client.insert(schema.upvoteTable).values({
              id: generateId("upvote"),
              postId: input.postId,
              userId: input.userId,
              memberId: input.memberId,
            })
          )
        )({
          postId,
          userId,
          memberId: Option.getOrNull(member)?.id ?? null,
        });

        return { upvoted: true };
      }),
  };
});

export class UpvoteRepository extends Context.Service<UpvoteRepository>()(
  "UpvoteRepository",
  {
    make: makeUpvoteRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
