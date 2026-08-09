import { currentDb, schema } from "@feeblo/db";
import { EmailContactId, EmailSubscriptionId } from "@feeblo/id";
import { and, eq, inArray, isNull } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  type EmailContactRecord as Contact,
  EmailContactRecord,
  EmailSubscriptionDataError,
  EmailSubscriptionInputError,
  EmailSubscriptionRecord,
  type EmailSubscriptionSource,
  type EmailSuppressionReason,
  normalizeEmailAddress,
  type EmailSubscriptionRecord as Subscription,
  type EmailSubscriptionTopic as Topic,
} from "./schema";
import {
  type EmailSubscriptionToken,
  type EmailSubscriptionTokenError,
  generateEmailSubscriptionToken,
  hashEmailSubscriptionToken,
  redactEmailSubscriptionToken,
} from "./tokens";

export interface RequestEmailSubscriptionInput {
  readonly alreadyVerifiedUser?: { readonly userId: string };
  readonly email: string;
  readonly now: Date;
  readonly organizationId: string;
  readonly source: EmailSubscriptionSource;
  readonly topic: Topic;
  readonly userId?: string;
  readonly verificationExpiresAt: Date;
}

export interface FindEmailSubscriptionInput {
  readonly email: string;
  readonly organizationId: string;
  readonly topic: Topic;
}

export interface VerifyEmailSubscriptionInput {
  readonly now: Date;
  readonly verificationToken: string;
}

export interface UnsubscribeEmailSubscriptionInput {
  readonly now: Date;
  readonly unsubscribeToken: string;
}

export interface UpsertEmailSuppressionInput {
  readonly email: string;
  readonly providerEventId: string | null;
  readonly reason: EmailSuppressionReason;
}

const dataError = (
  operation: string,
  reason: string
): EmailSubscriptionDataError =>
  new EmailSubscriptionDataError({ operation, reason });

const decodeContact = (
  input: unknown,
  operation: string
): Effect.Effect<Contact, EmailSubscriptionDataError> =>
  Schema.decodeUnknownEffect(EmailContactRecord)(input).pipe(
    Effect.mapError(() =>
      dataError(operation, "Stored email contact is invalid")
    )
  );

const decodeSubscription = (
  input: unknown,
  operation: string
): Effect.Effect<Subscription, EmailSubscriptionDataError> =>
  Schema.decodeUnknownEffect(EmailSubscriptionRecord)(input).pipe(
    Effect.mapError(() =>
      dataError(operation, "Stored email subscription is invalid")
    )
  );

const topicCondition = (
  table: typeof schema.emailSubscriptionTable,
  topic: Topic
) =>
  topic.topicId === null
    ? and(eq(table.topicType, topic.topicType), isNull(table.topicId))
    : and(
        eq(table.topicType, topic.topicType),
        eq(table.topicId, topic.topicId)
      );

const verifiedStateFor = (
  subscription: Subscription | undefined,
  alreadyVerified: boolean
): Subscription["state"] => {
  if (
    subscription?.state === "paused_by_plan" ||
    subscription?.state === "unsubscribed"
  ) {
    return subscription.state;
  }
  if (alreadyVerified || subscription?.state === "active") {
    return "active";
  }
  return "pending_verification";
};

const makeEmailSubscriptionRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  const findContact = (organizationId: string, email: string) =>
    Effect.gen(function* () {
      const [row] = yield* db
        .select()
        .from(schema.emailContactTable)
        .where(
          and(
            eq(schema.emailContactTable.organizationId, organizationId),
            eq(schema.emailContactTable.email, email)
          )
        )
        .limit(1);
      return row === undefined
        ? Option.none<Contact>()
        : Option.some(yield* decodeContact(row, "findContact"));
    });

  const findSubscriptionForContact = (contactId: string, topic: Topic) =>
    Effect.gen(function* () {
      const [row] = yield* db
        .select()
        .from(schema.emailSubscriptionTable)
        .where(
          and(
            eq(schema.emailSubscriptionTable.contactId, contactId),
            topicCondition(schema.emailSubscriptionTable, topic)
          )
        )
        .limit(1);
      return row === undefined
        ? Option.none<Subscription>()
        : Option.some(yield* decodeSubscription(row, "findSubscription"));
    });

  const requestSubscription = Effect.fn(
    "EmailSubscriptionRepository.requestSubscription"
  )(function* (input: RequestEmailSubscriptionInput) {
    const email = yield* normalizeEmailAddress(
      input.email,
      "requestSubscription"
    );
    const alreadyVerified = input.alreadyVerifiedUser !== undefined;
    if (
      alreadyVerified &&
      (input.userId === undefined ||
        input.userId !== input.alreadyVerifiedUser.userId)
    ) {
      return yield* new EmailSubscriptionInputError({
        operation: "requestSubscription",
        reason: "Verified user evidence must match the subscription user",
      });
    }

    const contactId = yield* EmailContactId.generate;
    const [createdContact] = yield* db
      .insert(schema.emailContactTable)
      .values({
        id: contactId,
        organizationId: input.organizationId,
        userId: input.userId ?? null,
        email,
        verificationState: alreadyVerified ? "verified" : "pending",
        verifiedAt: alreadyVerified ? input.now : null,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoNothing({
        target: [
          schema.emailContactTable.organizationId,
          schema.emailContactTable.email,
        ],
      })
      .returning();
    const contact =
      createdContact === undefined
        ? yield* findContact(input.organizationId, email).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () =>
                  Effect.fail(
                    dataError(
                      "requestSubscription.createContact",
                      "Email contact conflict did not resolve to a stored row"
                    )
                  ),
                onSome: Effect.succeed,
              })
            )
          )
        : yield* decodeContact(
            createdContact,
            "requestSubscription.createContact"
          );

    const persistedContact =
      alreadyVerified &&
      (contact.verificationState !== "verified" ||
        contact.userId !== input.userId)
        ? yield* Effect.gen(function* () {
            const [updated] = yield* db
              .update(schema.emailContactTable)
              .set({
                userId: input.userId,
                verificationState: "verified",
                verifiedAt: input.now,
                updatedAt: input.now,
              })
              .where(eq(schema.emailContactTable.id, contact.id))
              .returning();
            if (updated === undefined) {
              return yield* dataError(
                "requestSubscription.verifyContact",
                "Email contact update did not return a row"
              );
            }
            return yield* decodeContact(
              updated,
              "requestSubscription.verifyContact"
            );
          })
        : contact;

    const existingSubscription = yield* findSubscriptionForContact(
      persistedContact.id,
      input.topic
    );
    const priorSubscription = Option.getOrUndefined(existingSubscription);
    if (priorSubscription?.state === "unsubscribed") {
      return {
        contact: persistedContact,
        subscription: priorSubscription,
        unsubscribeToken: Option.none<EmailSubscriptionToken>(),
        verificationToken: Option.none<EmailSubscriptionToken>(),
      };
    }
    const state = verifiedStateFor(priorSubscription, alreadyVerified);
    const unsubscribeToken =
      priorSubscription === undefined
        ? Option.some(yield* generateEmailSubscriptionToken)
        : Option.none<EmailSubscriptionToken>();
    const unsubscribeTokenHash = Option.isSome(unsubscribeToken)
      ? yield* hashEmailSubscriptionToken(unsubscribeToken.value)
      : null;
    const verificationToken =
      state === "pending_verification"
        ? Option.some(yield* generateEmailSubscriptionToken)
        : Option.none<EmailSubscriptionToken>();
    const verificationTokenHash = Option.isSome(verificationToken)
      ? yield* hashEmailSubscriptionToken(verificationToken.value)
      : null;

    const subscription = priorSubscription
      ? yield* Effect.gen(function* () {
          const [updated] = yield* db
            .update(schema.emailSubscriptionTable)
            .set({
              source: input.source,
              state,
              verificationTokenHash,
              verificationExpiresAt:
                state === "pending_verification"
                  ? input.verificationExpiresAt
                  : null,
              verifiedAt:
                state === "active" && priorSubscription.verifiedAt === null
                  ? input.now
                  : priorSubscription.verifiedAt,
              unsubscribedAt: state === "unsubscribed" ? input.now : null,
              updatedAt: input.now,
            })
            .where(eq(schema.emailSubscriptionTable.id, priorSubscription.id))
            .returning();
          if (updated === undefined) {
            return yield* dataError(
              "requestSubscription.updateSubscription",
              "Email subscription update did not return a row"
            );
          }
          return yield* decodeSubscription(
            updated,
            "requestSubscription.updateSubscription"
          );
        })
      : yield* Effect.gen(function* () {
          const id = yield* EmailSubscriptionId.generate;
          const [created] = yield* db
            .insert(schema.emailSubscriptionTable)
            .values({
              id,
              organizationId: input.organizationId,
              contactId: persistedContact.id,
              topicType: input.topic.topicType,
              topicId: input.topic.topicId,
              source: input.source,
              state,
              verificationTokenHash,
              verificationExpiresAt:
                state === "pending_verification"
                  ? input.verificationExpiresAt
                  : null,
              unsubscribeTokenHash,
              verifiedAt: state === "active" ? input.now : null,
              unsubscribedAt: null,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .returning();
          if (created === undefined) {
            return yield* dataError(
              "requestSubscription.createSubscription",
              "Email subscription insert did not return a row"
            );
          }
          return yield* decodeSubscription(
            created,
            "requestSubscription.createSubscription"
          );
        });

    return {
      contact: persistedContact,
      subscription,
      unsubscribeToken,
      verificationToken,
    };
  });

  const findSubscription = Effect.fn(
    "EmailSubscriptionRepository.findSubscription"
  )(function* (input: FindEmailSubscriptionInput) {
    const email = yield* normalizeEmailAddress(input.email, "findSubscription");
    const contact = yield* findContact(input.organizationId, email);
    return Option.isSome(contact)
      ? yield* findSubscriptionForContact(contact.value.id, input.topic)
      : Option.none<Subscription>();
  });

  const verifySubscription = Effect.fn(
    "EmailSubscriptionRepository.verifySubscription"
  )(function* (input: VerifyEmailSubscriptionInput) {
    const tokenHash = yield* hashEmailSubscriptionToken(
      redactEmailSubscriptionToken(input.verificationToken)
    );
    const [row] = yield* db
      .select()
      .from(schema.emailSubscriptionTable)
      .where(eq(schema.emailSubscriptionTable.verificationTokenHash, tokenHash))
      .limit(1);
    if (row === undefined) {
      return { _tag: "Invalid" as const };
    }
    const subscription = yield* decodeSubscription(row, "verifySubscription");
    if (
      subscription.state === "active" ||
      subscription.state === "paused_by_plan"
    ) {
      return { _tag: "AlreadyVerified" as const };
    }
    if (
      subscription.state !== "pending_verification" ||
      subscription.verificationExpiresAt === null ||
      subscription.verificationExpiresAt.getTime() <= input.now.getTime()
    ) {
      return { _tag: "Expired" as const };
    }

    const [updated] = yield* db
      .update(schema.emailSubscriptionTable)
      .set({
        state: "active",
        verificationExpiresAt: null,
        verificationTokenHash: null,
        verifiedAt: input.now,
        updatedAt: input.now,
      })
      .where(eq(schema.emailSubscriptionTable.id, subscription.id))
      .returning();
    if (updated === undefined) {
      return yield* dataError(
        "verifySubscription",
        "Email subscription verification did not return a row"
      );
    }
    yield* db
      .update(schema.emailContactTable)
      .set({
        verificationState: "verified",
        verifiedAt: input.now,
        updatedAt: input.now,
      })
      .where(eq(schema.emailContactTable.id, subscription.contactId));
    return { _tag: "Verified" as const };
  });

  const unsubscribe = Effect.fn("EmailSubscriptionRepository.unsubscribe")(
    function* (input: UnsubscribeEmailSubscriptionInput) {
      const tokenHash = yield* hashEmailSubscriptionToken(
        redactEmailSubscriptionToken(input.unsubscribeToken)
      );
      const [row] = yield* db
        .select()
        .from(schema.emailSubscriptionTable)
        .where(
          eq(schema.emailSubscriptionTable.unsubscribeTokenHash, tokenHash)
        )
        .limit(1);
      if (row === undefined) {
        return { _tag: "Invalid" as const };
      }
      const subscription = yield* decodeSubscription(row, "unsubscribe");
      if (subscription.state === "unsubscribed") {
        return { _tag: "AlreadyUnsubscribed" as const };
      }
      const [updated] = yield* db
        .update(schema.emailSubscriptionTable)
        .set({
          state: "unsubscribed",
          unsubscribedAt: input.now,
          updatedAt: input.now,
        })
        .where(eq(schema.emailSubscriptionTable.id, subscription.id))
        .returning();
      if (updated === undefined) {
        return yield* dataError(
          "unsubscribe",
          "Email subscription unsubscribe did not return a row"
        );
      }
      return { _tag: "Unsubscribed" as const };
    }
  );

  /** Authenticated post-topic unsubscribe; it never accepts a bearer token. */
  const unsubscribeAuthenticatedPostSubscription = Effect.fn(
    "EmailSubscriptionRepository.unsubscribeAuthenticatedPostSubscription"
  )(function* ({
    now,
    organizationId,
    postId,
    userId,
  }: {
    readonly now: Date;
    readonly organizationId: string;
    readonly postId: string;
    readonly userId: string;
  }) {
    const rows = yield* db
      .select({
        id: schema.emailSubscriptionTable.id,
        state: schema.emailSubscriptionTable.state,
      })
      .from(schema.emailSubscriptionTable)
      .innerJoin(
        schema.emailContactTable,
        eq(schema.emailContactTable.id, schema.emailSubscriptionTable.contactId)
      )
      .where(
        and(
          eq(schema.emailSubscriptionTable.organizationId, organizationId),
          eq(schema.emailSubscriptionTable.topicType, "post"),
          eq(schema.emailSubscriptionTable.topicId, postId),
          eq(schema.emailContactTable.organizationId, organizationId),
          eq(schema.emailContactTable.userId, userId)
        )
      );
    if (rows.length === 0) {
      return { _tag: "NotSubscribed" as const };
    }
    const subscribedIds = rows.flatMap((row) =>
      row.state === "unsubscribed" ? [] : [row.id]
    );
    if (subscribedIds.length === 0) {
      return { _tag: "AlreadyUnsubscribed" as const };
    }
    const updated = yield* db
      .update(schema.emailSubscriptionTable)
      .set({
        state: "unsubscribed",
        unsubscribedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          inArray(schema.emailSubscriptionTable.id, subscribedIds),
          inArray(schema.emailSubscriptionTable.state, [
            "pending_verification",
            "active",
            "paused_by_plan",
          ])
        )
      )
      .returning({ id: schema.emailSubscriptionTable.id });
    return updated.length === 0
      ? { _tag: "AlreadyUnsubscribed" as const }
      : { _tag: "Unsubscribed" as const };
  });

  /** Synchronizes only reversible consent states with the workspace email plan. */
  const reconcileSubscriptionPlanStates = Effect.fn(
    "EmailSubscriptionRepository.reconcileSubscriptionPlanStates"
  )(function* ({
    eligible,
    now,
    organizationId,
  }: {
    readonly eligible: boolean;
    readonly now: Date;
    readonly organizationId: string;
  }) {
    const paused = eligible
      ? []
      : yield* db
          .update(schema.emailSubscriptionTable)
          .set({
            state: "paused_by_plan",
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.emailSubscriptionTable.organizationId, organizationId),
              eq(schema.emailSubscriptionTable.state, "active")
            )
          )
          .returning({ id: schema.emailSubscriptionTable.id });
    const resumed = eligible
      ? yield* db
          .update(schema.emailSubscriptionTable)
          .set({
            state: "active",
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.emailSubscriptionTable.organizationId, organizationId),
              eq(schema.emailSubscriptionTable.state, "paused_by_plan")
            )
          )
          .returning({ id: schema.emailSubscriptionTable.id })
      : [];
    return { paused: paused.length, resumed: resumed.length };
  });

  const findPlanStateOrganizationIds = Effect.fn(
    "EmailSubscriptionRepository.findPlanStateOrganizationIds"
  )(function* () {
    const rows = yield* db
      .selectDistinct({
        organizationId: schema.emailSubscriptionTable.organizationId,
      })
      .from(schema.emailSubscriptionTable)
      .where(
        inArray(schema.emailSubscriptionTable.state, [
          "active",
          "paused_by_plan",
        ])
      );
    return rows.map((row) => row.organizationId);
  });

  const upsertSuppression = Effect.fn(
    "EmailSubscriptionRepository.upsertSuppression"
  )(function* (input: UpsertEmailSuppressionInput) {
    const email = yield* normalizeEmailAddress(
      input.email,
      "upsertSuppression"
    );
    if (input.providerEventId !== null) {
      const [inserted] = yield* db
        .insert(schema.emailSuppressionTable)
        .values({
          email,
          reason: input.reason,
          providerEventId: input.providerEventId,
        })
        .onConflictDoNothing({
          target: schema.emailSuppressionTable.providerEventId,
        })
        .returning({ email: schema.emailSuppressionTable.email });
      return inserted === undefined
        ? { _tag: "DuplicateEvent" as const }
        : { _tag: "Upserted" as const };
    }

    const [upserted] = yield* db
      .insert(schema.emailSuppressionTable)
      .values({
        email,
        reason: input.reason,
        providerEventId: null,
      })
      .onConflictDoUpdate({
        target: schema.emailSuppressionTable.email,
        set: { reason: input.reason },
      })
      .returning({ email: schema.emailSuppressionTable.email });
    return upserted !== undefined
      ? { _tag: "Upserted" as const }
      : yield* dataError(
          "upsertSuppression",
          "Suppression conflict did not resolve to a stored row"
        );
  });

  const isSuppressed = Effect.fn("EmailSubscriptionRepository.isSuppressed")(
    function* ({ email }: { readonly email: string }) {
      const normalizedEmail = yield* normalizeEmailAddress(
        email,
        "isSuppressed"
      );
      const [suppression] = yield* db
        .select({ email: schema.emailSuppressionTable.email })
        .from(schema.emailSuppressionTable)
        .where(eq(schema.emailSuppressionTable.email, normalizedEmail))
        .limit(1);
      return suppression !== undefined;
    }
  );

  return {
    findSubscription,
    isSuppressed,
    requestSubscription,
    unsubscribe,
    unsubscribeAuthenticatedPostSubscription,
    reconcileSubscriptionPlanStates,
    findPlanStateOrganizationIds,
    upsertSuppression,
    verifySubscription,
  };
});

export class EmailSubscriptionRepository extends Context.Service<EmailSubscriptionRepository>()(
  "EmailSubscriptionRepository",
  { make: makeEmailSubscriptionRepository }
) {
  static readonly layer = Layer.effect(this, this.make);
}

export type EmailSubscriptionRepositoryError =
  | EmailSubscriptionDataError
  | EmailSubscriptionInputError
  | EmailSubscriptionTokenError;
