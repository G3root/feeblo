import * as S from "effect/Schema";

/**
 * A normalized email address suitable for persistence and equality checks.
 *
 * Every email path stores the value this codec accepts, which is why the
 * suppression lookup can compare addresses with plain equality. Normalization
 * (`trim` + lowercase) is deliberately separate from validation: only the
 * owner of an address may decide whether a mixed-case input is a new address
 * or the same one, and every writer here says it is the same one.
 */
export const EmailAddress = S.String.pipe(
  S.check(S.isMinLength(3)),
  S.check(S.isMaxLength(320)),
  S.check(S.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/))
);

export type EmailAddress = S.Schema.Type<typeof EmailAddress>;

/** Trims and lowercases an address before it is validated or compared. */
export const normalizeEmailAddress = (input: string): string =>
  input.trim().toLowerCase();

/**
 * Canonical email-outbox and email-subscription vocabularies.
 *
 * The `email_outbox`, `email_delivery`, `email_contact`,
 * `email_subscription`, `email_suppression`, and `email_provider_event`
 * columns are plain text (not Postgres enums) so new values don't require
 * migrations; these Effect Schemas are the single source of truth. The column
 * types are derived from them in `schema/feedback.ts` (`$type<T...>()`), and
 * `@feeblo/domain` email modules embed the schema values in their record
 * structs.
 */

/** Canonical `email_outbox.kind` vocabulary. */
export const EmailIntentKind = S.Literals([
  "submission.created",
  "changelog.published",
  "subscription.verification_requested",
  "post.status_changed",
  "post.merged",
  "post.unmerged",
  "post.closed",
]);

export type TEmailIntentKind = S.Schema.Type<typeof EmailIntentKind>;

/** Canonical `email_outbox.state` vocabulary. */
export const EmailOutboxState = S.Literals([
  "pending",
  "materialized",
  "paused_by_plan",
  "failed",
  "expired",
]);

export type TEmailOutboxState = S.Schema.Type<typeof EmailOutboxState>;

/** Canonical `email_delivery.state` vocabulary. */
export const EmailDeliveryState = S.Literals([
  "queued",
  "sending",
  "accepted",
  "delivered",
  "deferred",
  "bounced",
  "failed",
  "suppressed",
  "paused_by_plan",
  "expired",
  /**
   * Terminal skip recorded by the dispatcher's organization-access gate: the
   * recipient had no verified account with organization access when the
   * delivery was attempted. Re-evaluated per attempt, so a recipient who
   * gains access later receives subsequent deliveries without backfill.
   */
  "no_organization_access",
]);

export type TEmailDeliveryState = S.Schema.Type<typeof EmailDeliveryState>;

/** Canonical `email_contact.verification_state` vocabulary. */
export const EmailContactVerificationState = S.Literals([
  "pending",
  "verified",
]);

export type TEmailContactVerificationState = S.Schema.Type<
  typeof EmailContactVerificationState
>;

/** Canonical `email_subscription.topic_type` vocabulary. */
export const EmailSubscriptionTopicType = S.Literals(["changelog", "post"]);

export type TEmailSubscriptionTopicType = S.Schema.Type<
  typeof EmailSubscriptionTopicType
>;

/** Canonical `email_subscription.source` vocabulary. */
export const EmailSubscriptionSource = S.Literals([
  "explicit",
  "post_creator",
  // A voter added on behalf of a customer by a staff member.
  "admin_added_voter",
]);

export type TEmailSubscriptionSource = S.Schema.Type<
  typeof EmailSubscriptionSource
>;

/** Canonical `email_subscription.state` vocabulary. */
export const EmailSubscriptionState = S.Literals([
  "pending_verification",
  "active",
  "paused_by_plan",
  "unsubscribed",
  /**
   * The subject has no verified account yet (e.g. a contact created from a
   * bare email by a staff member), so they cannot receive anything. The
   * dispatcher skips these; identity linking activates them once the subject
   * gains organization access.
   */
  "deferred_no_access",
]);

export type TEmailSubscriptionState = S.Schema.Type<
  typeof EmailSubscriptionState
>;

/**
 * Canonical `email_suppression.reason` vocabulary, ordered by precedence:
 * a complaint outranks a manual block, which outranks a hard bounce. The
 * precedence is what keeps `reason` from flapping when a second provider event
 * arrives for an address that is already suppressed.
 */
export const EmailSuppressionReason = S.Literals([
  "hard_bounce",
  "complaint",
  "administrative_block",
]);

export type TEmailSuppressionReason = S.Schema.Type<
  typeof EmailSuppressionReason
>;

/**
 * Canonical `email_provider_event.type` vocabulary; the
 * `ProviderLifecycleEvent` union in
 * `@feeblo/domain/email-provider-feedback/schema` matches these literals per
 * variant.
 */
export const EmailProviderEventType = S.Literals([
  "delivered",
  "deferred",
  "bounced",
  "failed",
  "complained",
]);

export type TEmailProviderEventType = S.Schema.Type<
  typeof EmailProviderEventType
>;
