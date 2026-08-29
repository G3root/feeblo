import { currentDb, schema } from "@feeblo/db";
import { ChangelogSubscriptionId } from "@feeblo/id";
import { and, eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

interface TSubscribe {
  memberId?: string | null;
  organizationId: string;
  userId: string;
}

interface TUnsubscribe {
  organizationId: string;
  userId: string;
}

interface TIsSubscribed {
  organizationId: string;
  userId: string;
}

interface TFindSubscribers {
  organizationId: string;
  /** Restricts the list to the given user's own subscription (public endpoints). */
  userId?: string;
}

const makeChangelogSubscriptionRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  return {
    /**
     * Subscribe a user to a workspace changelog. Idempotent: inserting when a
     * subscription already exists is a no-op thanks to the
     * `changelog_subscription_organizationId_userId` unique index.
     */
    subscribe: ({ organizationId, userId, memberId }: TSubscribe) =>
      Effect.gen(function* () {
        const id = yield* ChangelogSubscriptionId.generate;
        return yield* db
          .insert(schema.changelogSubscriptionTable)
          .values({
            id,
            userId,
            organizationId,
            memberId: memberId ?? null,
          })
          .onConflictDoNothing({
            target: [
              schema.changelogSubscriptionTable.organizationId,
              schema.changelogSubscriptionTable.userId,
            ],
          })
          .pipe(Effect.asVoid);
      }),

    unsubscribe: ({ organizationId, userId }: TUnsubscribe) =>
      db
        .delete(schema.changelogSubscriptionTable)
        .where(
          and(
            eq(schema.changelogSubscriptionTable.organizationId, organizationId),
            eq(schema.changelogSubscriptionTable.userId, userId)
          )
        )
        .pipe(Effect.asVoid),

    isSubscribed: ({ organizationId, userId }: TIsSubscribed) =>
      db
        .select({ id: schema.changelogSubscriptionTable.id })
        .from(schema.changelogSubscriptionTable)
        .where(
          and(
            eq(schema.changelogSubscriptionTable.organizationId, organizationId),
            eq(schema.changelogSubscriptionTable.userId, userId)
          )
        )
        .limit(1)
        .pipe(Effect.map((rows) => rows.length > 0)),

    findSubscribers: ({ organizationId, userId }: TFindSubscribers) =>
      db
        .select({
          id: schema.changelogSubscriptionTable.id,
          organizationId: schema.changelogSubscriptionTable.organizationId,
          userId: schema.changelogSubscriptionTable.userId,
          memberId: schema.changelogSubscriptionTable.memberId,
          createdAt: schema.changelogSubscriptionTable.createdAt,
          updatedAt: schema.changelogSubscriptionTable.updatedAt,
        })
        .from(schema.changelogSubscriptionTable)
        .where(
          and(
            eq(schema.changelogSubscriptionTable.organizationId, organizationId),
            ...(userId
              ? [eq(schema.changelogSubscriptionTable.userId, userId)]
              : [])
          )
        ),
  };
});

export class ChangelogSubscriptionRepository extends Context.Service<ChangelogSubscriptionRepository>()(
  "ChangelogSubscriptionRepository",
  {
    make: makeChangelogSubscriptionRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
