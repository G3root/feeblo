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
 * Whether a delivery's email can be proven to name only public posts.
 *
 * The gate at send time reads the rows that exist now, but the email names the
 * posts that resolved when it was rendered. A post deleted — or moved to a
 * private board — since then is missing from that read while its title is still
 * in the mail, so the snapshot taken with the payload is what keeps the
 * decision fail-closed.
 *
 * The snapshot is authoritative for what the mail named at render time, and the
 * current rows are the only witness for what the recipient can reach today;
 * either can deny rule 3 and neither overrules the other's denial:
 *
 * | captured  | current   | verdict | because                                     |
 * | --------- | --------- | ------- | ------------------------------------------- |
 * | `PRIVATE` | any       | PRIVATE | the mail names a post that was not public    |
 * | `PUBLIC`  | `PRIVATE` | PRIVATE | a named post is not public now               |
 * | `PUBLIC`  | `PUBLIC`  | PUBLIC  | both halves agree                            |
 * | `PUBLIC`  | `null`    | null    | nothing resolves, so the proof is gone       |
 * | `null`    | any       | current | nothing was named, so nothing to prove       |
 * | undefined | any       | current | delivery predates the snapshot               |
 *
 * The `PUBLIC`/`null` row is the fail-closed one, matching the rule-3
 * principle for unresolvable posts and boards: deletion is the strongest
 * removal action, and it must not be the only one that still ships a rendered
 * title to a recipient without workspace membership.
 */
export const evaluateNotifiedBoardVisibility = ({
  captured,
  current,
}: {
  readonly captured: PostBoardVisibility | null | undefined;
  readonly current: PostBoardVisibility | null;
}): PostBoardVisibility | null => {
  if (captured === undefined || captured === null) {
    return current;
  }

  if (captured === "PRIVATE" || current === "PRIVATE") {
    return "PRIVATE";
  }

  return current === "PUBLIC" ? "PUBLIC" : null;
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
        : // Defensive: accounts restricted to a different organization carry
          // synthetic inboxes, so resolution cannot reach them in practice; if
          // one ever is reached it grants this workspace nothing.
          "shadow";

  const eligible =
    account.emailVerified &&
    (hasMembership ||
      account.restrictedToOrganizationId === organizationId ||
      (account.restrictedToOrganizationId === null &&
        boardVisibility === "PUBLIC"));

  return { eligible, recipientClass };
};
