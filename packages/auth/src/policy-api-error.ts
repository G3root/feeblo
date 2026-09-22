import { PolicyDeniedError } from "@feeblo/domain/policy";
import { APIError } from "better-auth/api";

/**
 * Maps Feeblo's `PolicyDeniedError` to the better-auth `APIError` its hooks
 * are allowed to throw.
 *
 * Anything else is returned untouched so a database or programming failure is
 * not dressed up as a policy decision, and only the policy's human-readable
 * reason (never internal detail) reaches the response body.
 */
export const mapPolicyDeniedToApiError = <T>(error: T): T | APIError => {
  if (error instanceof PolicyDeniedError) {
    return new APIError("FORBIDDEN", {
      message: error.reason ?? "Forbidden",
    });
  }

  return error;
};
