/** biome-ignore-all lint/suspicious/noExplicitAny: better-auth session/user types are intentionally loose */
import type { GenericEndpointContext, Session, User } from "better-auth";

export type JwtAutoLoginSession = { session: Session; user: User } & {
  user: { restrictedToOrganizationId: string | null };
} & Record<string, any>;

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
    | "FAILED_TO_CREATE_SSO_CONTACT";
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
      user: UserWithJwtAutoLogin & Record<string, any>;
      session: Session & Record<string, any>;
    };
    newUser: {
      user: User & Record<string, any>;
      session: Session & Record<string, any>;
    };
    ctx: GenericEndpointContext;
  }) => Promise<void> | void;
}
