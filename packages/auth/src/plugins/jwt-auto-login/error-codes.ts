import { defineErrorCodes } from "@better-auth/core/utils/error-codes";

export const JWT_AUTO_LOGIN_ERROR_CODES = defineErrorCodes({
  // Mirrors the better-auth anonymous plugin so the upgrade/linking flow
  // surfaces the same failure modes as a regular anonymous sign-in.
  FAILED_TO_CREATE_USER: "Failed to create user",
  COULD_NOT_CREATE_SESSION: "Could not create session",
  ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY:
    "Anonymous users cannot sign in again anonymously",
  USER_IS_NOT_ANONYMOUS: "User is not anonymous",
  FAILED_TO_DELETE_ANONYMOUS_USER: "Failed to delete anonymous user",
  FAILED_TO_DELETE_ANONYMOUS_USER_SESSIONS:
    "Failed to delete anonymous user sessions",
  DELETE_ANONYMOUS_USER_DISABLED: "Deleting anonymous users is disabled",
  // SSO (widget portal) specific failures raised while verifying the
  // organization JWT and provisioning the restricted widget user/contact.
  ORGANIZATION_HAS_NO_JWT_SECRET: "Organization has no JWT secret configured",
  WIDGET_SSO_NOT_ENTITLED: "Widget SSO requires the Starter plan or higher",
  INVALID_JWT: "Invalid JWT",
  SSO_TOKEN_MISSING_EMAIL_OR_NAME: "SSO token must include email and name",
  FAILED_TO_CREATE_SSO_CONTACT: "Failed to create contact for SSO session",
  FAILED_TO_CREATE_SSO_USER: "Failed to create SSO user",
  SSO_RATE_LIMITED: "Too many SSO sign-in attempts. Please try again later.",
  SSO_RATE_LIMIT_UNAVAILABLE:
    "SSO sign-in is temporarily unavailable. Please try again later.",
});

export type JwtAutoLoginErrorCode = keyof typeof JWT_AUTO_LOGIN_ERROR_CODES;
