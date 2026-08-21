import { isShadowUserEmail } from "../identity/emails";

/**
 * Organization-access eligibility for post-update email recipients
 * (plan-on-behalf.md, "Notification eligibility").
 *
 * The rule is stateless and re-evaluated per delivery attempt beside the
 * existing plan/consent/suppression checks: a recipient passes iff their
 * account is email-verified AND any of
 *
 * 1. they have a `member` row in the organization,
 * 2. their account is bound to the organization through SSO
 *    (`user.restrictedToOrganizationId` equals the organization id),
 * 3. they are an unrestricted global user and the post's board is `PUBLIC`.
 *
 * Everyone else — including manually added voters who exist only as a contact
 * plus shadow user — is skipped until they gain real access. Because the check
 * runs per attempt, a recipient who gains access later starts receiving
 * subsequent deliveries with no backfill and no state change.
 */

/** Observability class of one delivery recipient (metrics/log fields). */
export type EmailRecipientAccessClass = "member" | "sso" | "global" | "shadow";

/** Board visibility of the post an intent notifies about, when still resolvable. */
export type PostBoardVisibility = "PUBLIC" | "PRIVATE";

/**
 * The account facts the gate needs. `null` means no account could be reached
 * for the recipient: a bare contact without a linked or matching user.
 */
export type OrganizationAccessAccount = {
  readonly email: string;
  readonly emailVerified: boolean;
  readonly restrictedToOrganizationId: string | null;
};

export type OrganizationAccessSubject = {
  /** Resolved recipient account, or `null` for a contact-only recipient. */
  readonly account: OrganizationAccessAccount | null;
  /** Whether the resolved account has a `member` row in the organization. */
  readonly hasMembership: boolean;
  /**
   * Visibility of the post's board; `null` when the post or board no longer
   * resolves, which fails rule 3 (fail-closed) without affecting rules 1–2.
   */
  readonly boardVisibility: PostBoardVisibility | null;
  readonly organizationId: string;
};

export type OrganizationAccessVerdict = {
  readonly eligible: boolean;
  readonly recipientClass: EmailRecipientAccessClass;
};

/**
 * Classifies one recipient and decides whether post-update email may leave to
 * them. Pure so the vocabulary stays unit-testable without a database.
 */
export const evaluateOrganizationAccess = (
  subject: OrganizationAccessSubject
): OrganizationAccessVerdict => {
  const { account, boardVisibility, hasMembership, organizationId } = subject;

  // An attribution-only shadow account can never authenticate, so it never
  // counts as organization access even before its verification state matters.
  if (account === null || isShadowUserEmail(account.email)) {
    return { eligible: false, recipientClass: "shadow" };
  }

  const recipientClass: EmailRecipientAccessClass = hasMembership
    ? "member"
    : account.restrictedToOrganizationId === organizationId
      ? "sso"
      : account.restrictedToOrganizationId === null
        ? "global"
        // Defensive: accounts restricted to a different organization carry
        // synthetic inboxes, so resolution cannot reach them in practice; if
        // one ever is reached it grants this workspace nothing.
        : "shadow";

  const eligible =
    account.emailVerified &&
    (hasMembership ||
      account.restrictedToOrganizationId === organizationId ||
      (account.restrictedToOrganizationId === null &&
        boardVisibility === "PUBLIC"));

  return { eligible, recipientClass };
};
