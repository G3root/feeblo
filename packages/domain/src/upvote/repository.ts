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
          eq(schema.post.id, postId),
          eq(schema.post.organizationId, organizationId),
          ...(visibility ? [eq(schema.board.visibility, visibility)] : []),
        ];
        const post = yield* db
          .makeQuery((execute, input: TOperatorsQuery) =>
            execute((client) =>
              client
                .select({ id: schema.post.id })
                .from(schema.post)
                .innerJoin(
                  schema.board,
                  eq(schema.board.id, schema.post.boardId)
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
                id: schema.upvote.id,
                postId: schema.upvote.postId,
                organizationId: schema.post.organizationId,
                userId: schema.upvote.userId,
                user: {
                  name: schema.user.name,
                  image: schema.user.image,
                },
                memberId: schema.upvote.memberId,
                createdAt: schema.upvote.createdAt,
                updatedAt: schema.upvote.updatedAt,
              })
              .from(schema.upvote)
              .innerJoin(schema.post, eq(schema.post.id, schema.upvote.postId))
              .innerJoin(schema.user, eq(schema.user.id, schema.upvote.userId))
              .where(
                and(
                  eq(schema.post.organizationId, input.organizationId),
                  eq(schema.upvote.postId, input.postId)
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
          eq(schema.post.id, postId),
          eq(schema.post.organizationId, organizationId),
          ...(visibility ? [eq(schema.board.visibility, visibility)] : []),
        ];
        const post = yield* db
          .makeQuery((execute, input: TOperatorsQuery) =>
            execute((client) =>
              client
                .select({ id: schema.post.id })
                .from(schema.post)
                .innerJoin(
                  schema.board,
                  eq(schema.board.id, schema.post.boardId)
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
                .select({ id: schema.upvote.id })
                .from(schema.upvote)
                .where(
                  and(
                    eq(schema.upvote.postId, input.postId),
                    eq(schema.upvote.userId, input.userId)
                  )
                )
                .limit(1)
            )
          )({ postId, userId })
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isSome(existingUpvote)) {
          yield* db.makeQuery((execute, input: TDeleteUpvote) =>
            execute((client) =>
              client.delete(schema.upvote).where(eq(schema.upvote.id, input.id))
            )
          )({ id: existingUpvote.value.id });

          return { upvoted: false };
        }

        const member = yield* db
          .makeQuery((execute, input: TFindMember) =>
            execute((client) =>
              client
                .select({ id: schema.member.id })
                .from(schema.member)
                .where(
                  and(
                    eq(schema.member.organizationId, input.organizationId),
                    eq(schema.member.userId, input.userId)
                  )
                )
                .limit(1)
            )
          )({ organizationId, userId })
          .pipe(Effect.map(EffectArray.get(0)));

        yield* db.makeQuery((execute, input: TCreateUpvote) =>
          execute((client) =>
            client.insert(schema.upvote).values({
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
