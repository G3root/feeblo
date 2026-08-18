import type { GenericEndpointContext, Session, User } from "better-auth";
import type {
  addOAuthServerContext as baseAddOAuthServerContext,
  getOAuthState as baseGetOAuthState,
  getSessionFromCtx as baseGetSessionFromCtx,
} from "better-auth/api";

/** Extra claims Better Auth carries through the session objects. */
export type SessionExtraFields = Record<
  string,
  string | number | boolean | null | undefined | Date
>;

export type JwtAutoLoginSession = { session: Session; user: User } & {
  user: { restrictedToOrganizationId: string | null };
} & SessionExtraFields;

export interface UserWithJwtAutoLogin extends User {
  restrictedToOrganizationId: string;
}

/**
 * Result returned by {@link JwtAutoLoginOptions.createSsoUser} when the
 * organization JWT has been verified and the restricted widget user + contact
 * have been provisioned.
 */
export interface SsoUserResult {
  name: string;
  userId: string;
}

/**
 * Failure raised by {@link JwtAutoLoginOptions.createSsoUser}. The plugin maps
 * `code` to a better-auth `APIError` using {@link JWT_AUTO_LOGIN_ERROR_CODES}.
 */
export interface SsoUserError {
  code:
    | "ORGANIZATION_HAS_NO_JWT_SECRET"
    | "INVALID_JWT"
    | "SSO_TOKEN_MISSING_EMAIL_OR_NAME"
    | "FAILED_TO_CREATE_SSO_USER"
    | "FAILED_TO_CREATE_SSO_CONTACT"
    | "WIDGET_SSO_NOT_ENTITLED"
    | "SSO_RATE_LIMITED"
    | "SSO_RATE_LIMIT_UNAVAILABLE";
  message?: string;
}

export interface JwtAutoLoginOptions {
  /**
   * Verifies the organization JWT, parses the contact identity and upserts the
   * restricted widget user + linked contact. Returns the user id + display
   * name so the plugin can mint a better-auth session, or a {@link SsoUserError}
   * so the plugin can surface the correct error code.
   */
  createSsoUser: (input: {
    /** Peer-validated client IP injected by the server auth boundary. */
    clientIp: string;
    organizationId: string;
    token: string;
  }) => Promise<SsoUserResult | SsoUserError>;

  /**
   * Invoked when a restricted widget user links to a real account during a
   * global sign-in. Transfer data (contacts / posts) from the anonymous user
   * to the new user before the anonymous user is deleted.
   */
  onLinkAccount?: (data: {
    anonymousUser: {
      user: UserWithJwtAutoLogin & SessionExtraFields;
      session: Session & SessionExtraFields;
    };
    newUser: {
      user: User & SessionExtraFields;
      session: Session & SessionExtraFields;
    };
    ctx: GenericEndpointContext;
  }) => Promise<void> | void;

  /**
   * Better-auth session internals the plugin needs to read the current
   * session and carry the anonymous user across the OAuth redirect. Defaults
   * to the real implementations; injectable so the plugin can be tested with a
   * faithful seam instead of module mocks.
   */
  getSessionFromCtx?: typeof baseGetSessionFromCtx;
  getOAuthState?: typeof baseGetOAuthState;
  addOAuthServerContext?: typeof baseAddOAuthServerContext;
}
