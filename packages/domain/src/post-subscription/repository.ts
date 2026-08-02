import { currentDb, schema } from "@feeblo/db";
import { PostSubscriptionId } from "@feeblo/id";
import { and, eq } from "drizzle-orm";
import * as EffectArray from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

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
  /** Restricts the list to subscriptions on public boards (used by public endpoints). */
  publicOnly?: boolean;
}

const makePostSubscriptionRepository = Effect.gen(function* () {
  const db = yield* currentDb;

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
          .insert(schema.postSubscriptionTable)
          .values({
            id,
            postId,
            userId,
            organizationId,
            memberId: memberId ?? null,
          })
          .onConflictDoNothing({
            target: [
              schema.postSubscriptionTable.postId,
              schema.postSubscriptionTable.userId,
            ],
          })
          .pipe(Effect.asVoid);
      }),

    unsubscribe: ({ postId, userId }: TUnsubscribe) =>
      db
        .delete(schema.postSubscriptionTable)
        .where(
          and(
            eq(schema.postSubscriptionTable.postId, postId),
            eq(schema.postSubscriptionTable.userId, userId)
          )
        )
        .pipe(Effect.asVoid),

    isSubscribed: ({ organizationId, postId, userId }: TIsSubscribed) =>
      db
        .select({ id: schema.postSubscriptionTable.id })
        .from(schema.postSubscriptionTable)
        .where(
          and(
            eq(schema.postSubscriptionTable.organizationId, organizationId),
            eq(schema.postSubscriptionTable.postId, postId),
            eq(schema.postSubscriptionTable.userId, userId)
          )
        )
        .limit(1)
        .pipe(Effect.map(EffectArray.get(0)), Effect.map(Option.isSome)),

    findSubscribers: ({
      organizationId,
      postId,
      publicOnly = false,
    }: TFindSubscribers) =>
      db
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
        .innerJoin(
          schema.postTable,
          eq(schema.postTable.id, schema.postSubscriptionTable.postId)
        )
        .innerJoin(
          schema.boardTable,
          eq(schema.boardTable.id, schema.postTable.boardId)
        )
        .where(
          and(
            eq(schema.postSubscriptionTable.organizationId, organizationId),
            eq(schema.postSubscriptionTable.postId, postId),
            ...(publicOnly ? [eq(schema.boardTable.visibility, "PUBLIC")] : [])
          )
        ),
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
