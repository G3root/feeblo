import { defineErrorCodes } from "@better-auth/core/utils/error-codes";

export const JWT_AUTO_LOGIN_ERROR_CODES = defineErrorCodes({
  FAILED_TO_CREATE_USER: "Failed to create user",
  COULD_NOT_CREATE_SESSION: "Could not create session",
  ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY:
    "Anonymous users cannot sign in again anonymously",
  USER_IS_NOT_ANONYMOUS: "User is not anonymous",
});
