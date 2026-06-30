import { Database, schema } from "@feeblo/db";
import { PostSubscriptionId } from "@feeblo/id";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Array as EffectArray, Layer, Option } from "effect";

interface TSubscribe {
  memberId?: string | null;
  organizationId: string;
  postId: string;
  userId: string;
}

interface TUnsubscribe {
  postId: string;
  userId: string;
}

interface TIsSubscribed {
  organizationId: string;
  postId: string;
  userId: string;
}

interface TFindSubscribers {
  organizationId: string;
  postId: string;
}

interface TSubscribeQuery {
  id: string;
  memberId: string | null;
  organizationId: string;
  postId: string;
  userId: string;
}

interface TUnsubscribeQuery {
  postId: string;
  userId: string;
}

interface TIsSubscribedQuery {
  organizationId: string;
  postId: string;
  userId: string;
}

interface TFindSubscribersQuery {
  organizationId: string;
  postId: string;
}

const makePostSubscriptionRepository = Effect.gen(function* () {
  const db = yield* Database.Database;

  return {
    /**
     * Subscribe a user to a post. Idempotent: inserting when a subscription
     * already exists is a no-op thanks to the `post_subscription_postId_userId`
     * unique index.
     */
    subscribe: ({ organizationId, postId, userId, memberId }: TSubscribe) =>
      Effect.gen(function* () {
        const id = yield* PostSubscriptionId.generate;
        return yield* db
          .makeQuery((execute, input: TSubscribeQuery) =>
            execute((client) =>
              client
                .insert(schema.postSubscriptionTable)
                .values({
                  id: input.id,
                  postId: input.postId,
                  userId: input.userId,
                  organizationId: input.organizationId,
                  memberId: input.memberId,
                })
                .onConflictDoNothing({
                  target: [
                    schema.postSubscriptionTable.postId,
                    schema.postSubscriptionTable.userId,
                  ],
                })
            )
          )({
            id,
            postId,
            userId,
            organizationId,
            memberId: memberId ?? null,
          })
          .pipe(Effect.asVoid);
      }),

    unsubscribe: ({ postId, userId }: TUnsubscribe) =>
      db
        .makeQuery((execute, input: TUnsubscribeQuery) =>
          execute((client) =>
            client
              .delete(schema.postSubscriptionTable)
              .where(
                and(
                  eq(schema.postSubscriptionTable.postId, input.postId),
                  eq(schema.postSubscriptionTable.userId, input.userId)
                )
              )
          )
        )({ postId, userId })
        .pipe(Effect.asVoid),

    isSubscribed: ({ organizationId, postId, userId }: TIsSubscribed) =>
      db
        .makeQuery((execute, input: TIsSubscribedQuery) =>
          execute((client) =>
            client
              .select({ id: schema.postSubscriptionTable.id })
              .from(schema.postSubscriptionTable)
              .where(
                and(
                  eq(
                    schema.postSubscriptionTable.organizationId,
                    input.organizationId
                  ),
                  eq(schema.postSubscriptionTable.postId, input.postId),
                  eq(schema.postSubscriptionTable.userId, input.userId)
                )
              )
              .limit(1)
          )
        )({ organizationId, postId, userId })
        .pipe(Effect.map(EffectArray.get(0)), Effect.map(Option.isSome)),

    findSubscribers: ({ organizationId, postId }: TFindSubscribers) =>
      db.makeQuery((execute, input: TFindSubscribersQuery) =>
        execute((client) =>
          client
            .select({
              id: schema.postSubscriptionTable.id,
              postId: schema.postSubscriptionTable.postId,
              organizationId: schema.postSubscriptionTable.organizationId,
              userId: schema.postSubscriptionTable.userId,
              memberId: schema.postSubscriptionTable.memberId,
              createdAt: schema.postSubscriptionTable.createdAt,
              updatedAt: schema.postSubscriptionTable.updatedAt,
            })
            .from(schema.postSubscriptionTable)
            .where(
              and(
                eq(
                  schema.postSubscriptionTable.organizationId,
                  input.organizationId
                ),
                eq(schema.postSubscriptionTable.postId, input.postId)
              )
            )
        )
      )({ organizationId, postId }),
  };
});

export class PostSubscriptionRepository extends Context.Service<PostSubscriptionRepository>()(
  "PostSubscriptionRepository",
  {
    make: makePostSubscriptionRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
