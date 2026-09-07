import { currentDb, schema } from "@feeblo/db";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { EmailSubscriptionRepository } from "../email-subscription/repository";
import type { PostActivityMetadata } from "../post-activity/repository";
import { InternalServerError } from "../rpc-errors";
import { UserRepository } from "../user/repository";
import { isSyntheticEmail } from "./emails";
import { InvalidSubjectError, SubjectNotFoundError } from "./errors";
import {
  type OnBehalfSubject,
  type ResolvedPrincipal,
  ResolvePrincipalService,
} from "./service";

/** Verification links for on-behalf subscriptions stay valid one day. */
const VERIFICATION_WINDOW_MS = 86_400_000;

/**
 * Resolves an on-behalf subject inside the caller's transaction (see
 * plan-on-behalf.md). Shared by post, comment, and voter handlers so the
 * resolution priority and failure classification cannot drift: identity
 * failures surface as themselves, infrastructure failures are normalized to
 * an internal error naming the action (e.g. "post author", "voter").
 */
export const resolveOnBehalfSubject = (args: {
  readonly organizationId: string;
  readonly needsUser: boolean;
  readonly subject: OnBehalfSubject;
  /** Human noun for the failure message, e.g. "post author" or "voter". */
  readonly action: string;
}) =>
  Effect.gen(function* () {
    const resolvePrincipal = yield* ResolvePrincipalService;
    return yield* resolvePrincipal
      .resolve({
        organizationId: args.organizationId,
        needsUser: args.needsUser,
        subject: args.subject,
      })
      .pipe(
        Effect.mapError(
          (
            error
          ):
            | SubjectNotFoundError
            | InvalidSubjectError
            | InternalServerError =>
            error instanceof SubjectNotFoundError ||
            error instanceof InvalidSubjectError
              ? error
              : new InternalServerError({
                  message: `Could not resolve the ${args.action}.`,
                })
        )
      );
  });

/**
 * Builds the `{ onBehalfOf: { contactId, userId? } }` provenance stored on
 * `post_activity.metadata`. Absent subject means self-service: no metadata.
 */
export const toOnBehalfMetadata = (
  subject: ResolvedPrincipal | undefined
): PostActivityMetadata | undefined =>
  subject && {
    onBehalfOf: {
      contactId: subject.contactId,
      ...(subject.userId !== null && { userId: subject.userId }),
    },
  };

/**
 * Records the post email subscription for a resolved on-behalf subject,
 * following the notification-eligibility rules: a verified account with a
 * real (non-synthetic) address is trusted, everyone else is deferred until
 * identity linking grants them access — nothing is emailed, not even a
 * verification request. A verified SSO account carries a synthetic `sso-*`
 * inbox that can never receive mail, so it must not enter the trusted path;
 * it defers like any other unresolvable address.
 */
export const subscribeOnBehalfSubject = (args: {
  readonly organizationId: string;
  /** The post the subscription is filed under. */
  readonly topicId: string;
  readonly subject: ResolvedPrincipal;
  readonly source: "post_creator" | "admin_added_voter";
  /** Human noun for failure messages, e.g. "post author" or "voter". */
  readonly subjectKind: "post author" | "voter";
  readonly now: Date;
}) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const userRepository = yield* UserRepository;
    const emailSubscriptions = yield* EmailSubscriptionRepository;

    const subjectUser =
      args.subject.userId === null
        ? Option.none()
        : yield* userRepository.getById(args.subject.userId);
    const verifiedEmail =
      Option.isSome(subjectUser) &&
      subjectUser.value.emailVerified &&
      !isSyntheticEmail(subjectUser.value.email)
        ? subjectUser.value.email
        : undefined;

    if (verifiedEmail !== undefined && args.subject.userId !== null) {
      return yield* emailSubscriptions
        .requestSubscription({
          alreadyVerifiedUser: { userId: args.subject.userId },
          email: verifiedEmail,
          now: args.now,
          organizationId: args.organizationId,
          source: args.source,
          topic: { topicId: args.topicId, topicType: "post" },
          verificationExpiresAt: new Date(
            args.now.getTime() + VERIFICATION_WINDOW_MS
          ),
        })
        .pipe(
          Effect.mapError(
            () =>
              new InternalServerError({
                message: `Could not record the ${args.subjectKind} email subscription.`,
              })
          )
        );
    }

    const [contact] = yield* db
      .select({ email: schema.contactTable.email })
      .from(schema.contactTable)
      .where(eq(schema.contactTable.id, args.subject.contactId))
      .limit(1);
    const contactEmail = contact?.email;
    if (
      contactEmail !== null &&
      contactEmail !== undefined &&
      !isSyntheticEmail(contactEmail)
    ) {
      yield* emailSubscriptions
        .requestSubscription({
          deferredNoAccess: true,
          email: contactEmail,
          now: args.now,
          organizationId: args.organizationId,
          source: args.source,
          topic: { topicId: args.topicId, topicType: "post" },
          verificationExpiresAt: new Date(
            args.now.getTime() + VERIFICATION_WINDOW_MS
          ),
        })
        .pipe(
          Effect.mapError(
            () =>
              new InternalServerError({
                message: `Could not record the deferred ${args.subjectKind} email subscription.`,
              })
          )
        );
    }
  });
