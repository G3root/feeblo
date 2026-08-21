/**
 * Synthetic-inbox predicates shared by identity resolution, shadow-user
 * healing, and user provisioning. Kept dependency-free so every module in the
 * identity graph can import it without cycles.
 */

/** Synthetic inboxes of SSO portal and shadow users are never real addresses. */
export const isSyntheticEmail = (email: string): boolean =>
  /^behalf-[0-9a-f]+@feeblo\.com$/.test(email) ||
  /^sso-[0-9a-f]+@feeblo\.com$/.test(email);

/**
 * Email-local part of the synthetic inboxes backing shadow users. Distinct
 * from the `sso-` prefix of widget portal users: only `behalf-*` accounts are
 * attribution-only shadows that identity linking may consume.
 */
export const isShadowUserEmail = (email: string): boolean =>
  /^behalf-[0-9a-f]+@feeblo\.com$/.test(email);
