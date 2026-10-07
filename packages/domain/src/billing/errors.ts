import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";

export class FailedToCreateCheckoutError extends Schema.TaggedError<FailedToCreateCheckoutError>()(
  "FailedToCreateCheckoutError",
  {
    message: Schema.optional(Schema.String),
  },
  { httpApiStatus: 400, identifier: "FailedToCreateCheckoutError" }
) {}

export class FailedToCreatePortalError extends Schema.TaggedError<FailedToCreatePortalError>()(
  "FailedToCreatePortalError",
  {
    message: Schema.optional(Schema.String),
  },
  { httpApiStatus: 400, identifier: "FailedToCreatePortalError" }
) {}

/**
 * Raised (and handled by the caller) when a deleted organization's Polar
 * subscription cannot be revoked — the subscription would otherwise keep
 * billing after the tenant is gone.
 *
 * `alreadyRevoked` marks the one outcome that is not a failure: Polar answered
 * that the subscription is already canceled, non-billable, or gone, so the
 * postcondition the caller wanted already holds and the queue must close the
 * row instead of retrying it forever.
 */
export class FailedToRevokeSubscriptionError extends Schema.TaggedError<FailedToRevokeSubscriptionError>()(
  "FailedToRevokeSubscriptionError",
  {
    message: Schema.optional(Schema.String),
    alreadyRevoked: Schema.optional(Schema.Boolean),
  },
  { httpApiStatus: 500, identifier: "FailedToRevokeSubscriptionError" }
) {}

export const BillingServiceErrors = Schema.Union([
  UnauthorizedError,
  BadRequestError,
  InternalServerError,
  PolicyDeniedError,
  FailedToCreateCheckoutError,
  FailedToCreatePortalError,
]);
