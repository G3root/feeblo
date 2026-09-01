import { currentDb, schema } from "@feeblo/db";
import { EmailContactId, EmailSubscriptionId } from "@feeblo/id";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  type EmailContactRecord as Contact,
  EmailContactRecord,
  EmailSubscriptionDataError,
  type EmailSubscriptionInputError,
  EmailSubscriptionRecord,
  type EmailSubscriptionTokenRequest,
  parseEmailAddress,
  type EmailSubscriptionRecord as Subscription,
  type EmailSuppressionRecord as Suppression,
} from "./schema";
import {
  type EmailSubscriptionToken,
  type EmailSubscriptionTokenError,
  EmailSubscriptionTokenService,
  hashEmailSubscriptionToken,
  redactEmailSubscriptionToken,
} from "./tokens";

export type EmailSubscriptionTopicInput =
  | { readonly topicId: null; readonly topicType: "submission" | "changelog" }
  | { readonly topicId: string; readonly topicType: "post" };

export type RequestEmailSubscriptionInput = {
  readonly email: string;
  readonly organizationId: string;
  readonly source: Subscription["source"];
  readonly alreadyVerifiedUser?: {
    readonly userId: string;
  };
  readonly now: Contact["updatedAt"];
  readonly topic: EmailSubscriptionTopicInput;
  readonly verificationExpiresAt: Subscription["verificationExpiresAt"];
};

export type FindEmailSubscriptionInput = {
  readonly email: string;
  readonly organizationId: string;
  readonly topic: EmailSubscriptionTopicInput;
};

export interface VerifyEmailSubscriptionInput {
  readonly now: Subscription["updatedAt"];
  readonly verificationToken: EmailSubscriptionTokenRequest["token"];
}

export interface UnsubscribeEmailSubscriptionInput {
  readonly now: Subscription["updatedAt"];
  readonly unsubscribeToken: EmailSubscriptionTokenRequest["token"];
}

export type UpsertEmailSuppressionInput = Pick<
  Suppression,
  "email" | "providerEventId" | "reason"
>;

const dataError = (
  operation: string,
  reason: string
): EmailSubscriptionDataError =>
  new EmailSubscriptionDataError({ operation, reason });

const decodeContact = <V>(
  input: V,
  operation: string
): Effect.Effect<Contact, EmailSubscriptionDataError> =>
  Schema.decodeUnknownEffect(EmailContactRecord)(input).pipe(
    Effect.mapError(() =>
      dataError(operation, "Stored email contact is invalid")
    )
  );

const decodeSubscription = <V>(
  input: V,
  operation: string
): Effect.Effect<Subscription, EmailSubscriptionDataError> =>
  Schema.decodeUnknownEffect(EmailSubscriptionRecord)(input).pipe(
    Effect.mapError(() =>
      dataError(operation, "Stored email subscription is invalid")
    )
  );

const topicCondition = (
  table: typeof schema.emailSubscriptionTable,
  topic: EmailSubscriptionTopicInput
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
  if (alreadyVerified) {
    return "active";
  }
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
  const tokenService = yield* EmailSubscriptionTokenService;

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

  const findSubscriptionForContact = (
    contactId: string,
    topic: EmailSubscriptionTopicInput
  ) =>
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
    const email = yield* parseEmailAddress(input.email, "requestSubscription");
    const userId = input.alreadyVerifiedUser?.userId;
    const alreadyVerified = userId !== undefined;

    const contactId = yield* EmailContactId.generate;
    const [createdContact] = yield* db
      .insert(schema.emailContactTable)
      .values({
        id: contactId,
        organizationId: input.organizationId,
        userId: userId ?? null,
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
      (contact.verificationState !== "verified" || contact.userId !== userId)
        ? yield* Effect.gen(function* () {
            const [updated] = yield* db
              .update(schema.emailContactTable)
              .set({
                userId,
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
    if (priorSubscription?.state === "unsubscribed" && !alreadyVerified) {
      return {
        contact: persistedContact,
        subscription: priorSubscription,
        unsubscribeToken: Option.none<EmailSubscriptionToken>(),
        verificationToken: Option.none<EmailSubscriptionToken>(),
      };
    }
    const state = verifiedStateFor(priorSubscription, alreadyVerified);
    const subscriptionId =
      priorSubscription?.id ?? (yield* EmailSubscriptionId.generate);
    const unsubscribeToken =
      priorSubscription === undefined
        ? Option.some(
            yield* tokenService.deriveToken({
              purpose: "unsubscribe",
              subscriptionId,
            })
          )
        : Option.none<EmailSubscriptionToken>();
    const unsubscribeTokenHash = Option.isSome(unsubscribeToken)
      ? yield* hashEmailSubscriptionToken(unsubscribeToken.value)
      : null;
    const verificationToken =
      state === "pending_verification"
        ? Option.some(
            yield* tokenService.deriveToken({
              purpose: "verification",
              subscriptionId,
            })
          )
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
          const [created] = yield* db
            .insert(schema.emailSubscriptionTable)
            .values({
              id: subscriptionId,
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

  const configureSubmissionNotificationRecipient = Effect.fn(
    "EmailSubscriptionRepository.configureSubmissionNotificationRecipient"
  )(function* (
    input: RequestEmailSubscriptionInput & {
      readonly replaceOtherRecipients: boolean;
    }
  ) {
    const configured = yield* requestSubscription(input);
    if (input.replaceOtherRecipients) {
      yield* db
        .update(schema.emailSubscriptionTable)
        .set({
          state: "unsubscribed",
          unsubscribedAt: input.now,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(
              schema.emailSubscriptionTable.organizationId,
              input.organizationId
            ),
            eq(schema.emailSubscriptionTable.topicType, "submission"),
            isNull(schema.emailSubscriptionTable.topicId),
            ne(schema.emailSubscriptionTable.id, configured.subscription.id),
            inArray(schema.emailSubscriptionTable.state, [
              "active",
              "pending_verification",
              "paused_by_plan",
            ])
          )
        );
    }
    return configured;
  });

  const findSubscription = Effect.fn(
    "EmailSubscriptionRepository.findSubscription"
  )(function* (input: FindEmailSubscriptionInput) {
    const email = yield* parseEmailAddress(input.email, "findSubscription");
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

  /** Authenticated topic lookup used for toggle-button subscription state. */
  const findAuthenticatedSubscription = Effect.fn(
    "EmailSubscriptionRepository.findAuthenticatedSubscription"
  )(function* ({
    organizationId,
    topic,
    userId,
  }: {
    readonly organizationId: string;
    readonly topic: EmailSubscriptionTopicInput;
    readonly userId: string;
  }) {
    const [row] = yield* db
      .select({ state: schema.emailSubscriptionTable.state })
      .from(schema.emailSubscriptionTable)
      .innerJoin(
        schema.emailContactTable,
        eq(schema.emailContactTable.id, schema.emailSubscriptionTable.contactId)
      )
      .where(
        and(
          eq(schema.emailSubscriptionTable.organizationId, organizationId),
          topicCondition(schema.emailSubscriptionTable, topic),
          eq(schema.emailContactTable.organizationId, organizationId),
          eq(schema.emailContactTable.userId, userId)
        )
      )
      .limit(1);
    return row ?? null;
  });

  /** Authenticated topic unsubscribe; it never accepts a bearer token. */
  const unsubscribeAuthenticatedSubscription = Effect.fn(
    "EmailSubscriptionRepository.unsubscribeAuthenticatedSubscription"
  )(function* ({
    now,
    organizationId,
    topic,
    userId,
  }: {
    readonly now: Date;
    readonly organizationId: string;
    readonly topic: EmailSubscriptionTopicInput;
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
          topicCondition(schema.emailSubscriptionTable, topic),
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
    const email = yield* parseEmailAddress(input.email, "upsertSuppression");
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

  const deriveLinkToken = Effect.fn(
    "EmailSubscriptionRepository.deriveLinkToken"
  )(
    (input: {
      readonly purpose: "unsubscribe" | "verification";
      readonly subscriptionId: Subscription["id"];
    }) => tokenService.deriveToken(input)
  );

  return {
    deriveLinkToken,
    configureSubmissionNotificationRecipient,
    findAuthenticatedSubscription,
    findSubscription,
    requestSubscription,
    unsubscribe,
    unsubscribeAuthenticatedSubscription,
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
  static readonly layerWithoutDependencies = Layer.effect(this, this.make);
  static readonly layer = this.layerWithoutDependencies.pipe(
    Layer.provide(EmailSubscriptionTokenService.layer)
  );
}

export type EmailSubscriptionRepositoryError =
  | EmailSubscriptionDataError
  | EmailSubscriptionInputError
  | EmailSubscriptionTokenError;
