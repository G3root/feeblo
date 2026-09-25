import { PolicyDeniedError } from "@feeblo/domain/policy";
import { APIError } from "better-auth/api";
import * as Schema from "effect/Schema";

/**
 * Maps Feeblo's `PolicyDeniedError` to the better-auth `APIError` its hooks
 * are allowed to throw.
 *
 * Anything else is returned untouched so a database or programming failure is
 * not dressed up as a policy decision, and only the policy's human-readable
 * reason (never internal detail) reaches the response body.
 */
export const mapPolicyDeniedToApiError = <T>(error: T): T | APIError => {
  // `Schema.is`, not `instanceof`: better-auth hooks receive errors that may
  // have crossed a serialization boundary, where a decoded `PolicyDeniedError`
  // is a plain object carrying `_tag` and no prototype.
  if (Schema.is(PolicyDeniedError)(error)) {
    return new APIError("FORBIDDEN", {
      message: error.reason ?? "Forbidden",
    });
  }

  return error;
};
