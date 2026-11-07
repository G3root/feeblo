/**
 * Synthetic-inbox predicates shared by identity resolution, shadow-user
 * healing, and user provisioning. Kept dependency-free so every module in the
 * identity graph can import it without cycles.
 */

/** A `behalf-*` synthetic inbox: a shadow user, never a real address. */
const shadowUserEmailPattern = /^behalf-[0-9a-f]+@feeblo\.com$/;
/** An `sso-*` synthetic inbox: a widget portal user, never a real address. */
const portalUserEmailPattern = /^sso-[0-9a-f]+@feeblo\.com$/;

/** Synthetic inboxes of SSO portal and shadow users are never real addresses. */
export const isSyntheticEmail = (email: string): boolean =>
  shadowUserEmailPattern.test(email.toLowerCase()) ||
  portalUserEmailPattern.test(email.toLowerCase());

/**
 * Email-local part of the synthetic inboxes backing shadow users. Distinct
 * from the `sso-` prefix of widget portal users: only `behalf-*` accounts are
 * attribution-only shadows that identity linking may consume.
 */
export const isShadowUserEmail = (email: string): boolean =>
  shadowUserEmailPattern.test(email.toLowerCase());
