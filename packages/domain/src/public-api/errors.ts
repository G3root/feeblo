import * as Schema from "effect/Schema";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";

/**
 * The Public API's own error vocabulary.
 *
 * The codes are part of the versioned contract: append-only within `/api/v1`,
 * never re-pointed at a different meaning. They are deliberately *not* the
 * internal domain error identities (`UnauthorizedError`, `PolicyDeniedError`,
 * `NotFoundError`), which describe internals and change freely — the dashboard
 * can rename an error without changing what an integration switches on.
 *
 * The tag of each class *is* the code, which is what makes the encoded body
 * carry it. Errors are `Schema.TaggedError` classes rather than plain structs
 * with a status annotation because that is the only form the HTTP layer maps to
 * a response status: a plain struct with `HttpApiSchema.status` is answered as
 * `500`. So the published body is:
 *
 * ```json
 * { "_tag": "FORBIDDEN_SCOPE", "message": "…" }
 * ```
 *
 * `_tag` is the machine-readable code and is frozen by this vocabulary;
 * `message` is for humans and may change at any time. This matches what the
 * public portal's own HTTP API already returns.
 */
export const PUBLIC_API_ERROR_CODES = [
  "MISSING_API_KEY",
  "INVALID_API_KEY",
  "FORBIDDEN_SCOPE",
  "PLAN_REQUIRES_UPGRADE",
  "INVALID_REQUEST",
  "NOT_FOUND",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
  "SERVICE_UNAVAILABLE",
] as const;

export type PublicApiErrorCode = (typeof PUBLIC_API_ERROR_CODES)[number];

/** 401 — the request carried no `x-api-key` header. */
export class MissingApiKeyError extends Schema.TaggedError<MissingApiKeyError>()(
  "MISSING_API_KEY",
  { message: Schema.String },
  { httpApiStatus: 401, identifier: "MISSING_API_KEY" }
) {}

/** 401 — the key is unknown, revoked, disabled, or expired. */
export class InvalidApiKeyError extends Schema.TaggedError<InvalidApiKeyError>()(
  "INVALID_API_KEY",
  { message: Schema.String },
  { httpApiStatus: 401, identifier: "INVALID_API_KEY" }
) {}

/** 403 — the key does not hold the scope the endpoint requires. */
export class ForbiddenScopeError extends Schema.TaggedError<ForbiddenScopeError>()(
  "FORBIDDEN_SCOPE",
  { message: Schema.String },
  { httpApiStatus: 403, identifier: "FORBIDDEN_SCOPE" }
) {}

/** 403 — the workspace plan does not include the Public API. */
export class PlanRequiresUpgradeError extends Schema.TaggedError<PlanRequiresUpgradeError>()(
  "PLAN_REQUIRES_UPGRADE",
  { message: Schema.String },
  { httpApiStatus: 403, identifier: "PLAN_REQUIRES_UPGRADE" }
) {}

/** 400 — a malformed parameter, cursor, or limit. */
export class InvalidRequestError extends Schema.TaggedError<InvalidRequestError>()(
  "INVALID_REQUEST",
  { message: Schema.String },
  { httpApiStatus: 400, identifier: "INVALID_REQUEST" }
) {}

/** 404 — the resource does not exist in the calling workspace. */
export class NotFoundError extends Schema.TaggedError<NotFoundError>()(
  "NOT_FOUND",
  { message: Schema.String },
  { httpApiStatus: 404, identifier: "NOT_FOUND" }
) {}

/**
 * 429 — the per-key rate limit is exhausted. Carries `Retry-After` in seconds,
 * so an integration can back off without parsing the message.
 */
export class RateLimitedError extends Schema.TaggedError<RateLimitedError>()(
  "RATE_LIMITED",
  { message: Schema.String },
  { httpApiStatus: 429, identifier: "RATE_LIMITED" }
) {}

/** 500 — an unexpected server failure. */
export class InternalError extends Schema.TaggedError<InternalError>()(
  "INTERNAL_ERROR",
  { message: Schema.String },
  { httpApiStatus: 500, identifier: "INTERNAL_ERROR" }
) {}

/**
 * 503 — a dependency the request needs is unavailable. Rate limiting fails
 * closed rather than admitting unlimited traffic, so this is returned instead
 * of a silent bypass.
 */
export class ServiceUnavailableError extends Schema.TaggedError<ServiceUnavailableError>()(
  "SERVICE_UNAVAILABLE",
  { message: Schema.String },
  { httpApiStatus: 503, identifier: "SERVICE_UNAVAILABLE" }
) {}

/** 429 with the `Retry-After` header the contract promises. */
export const RateLimitedErrorWithHeaders = HttpApiSchema.WithHeaders(
  RateLimitedError,
  { "retry-after": Schema.String }
);

/**
 * Every error a caller can receive, in one place for endpoint declarations.
 *
 * Declared as an **array**, not a `Schema.Union`: the HTTP layer resolves each
 * declared schema's `httpApiStatus` individually, and a union is a single entry
 * whose own AST carries no status — which silently answers every error as 500.
 */
export const PUBLIC_API_ERROR_SCHEMAS = [
  MissingApiKeyError,
  InvalidApiKeyError,
  ForbiddenScopeError,
  PlanRequiresUpgradeError,
  InvalidRequestError,
  NotFoundError,
  RateLimitedErrorWithHeaders,
  InternalError,
  ServiceUnavailableError,
] as const;

export const missingApiKeyError = (
  message = "Provide an API key in the x-api-key header."
) => new MissingApiKeyError({ message });

export const invalidApiKeyError = (
  message = "The API key is unknown, revoked, disabled, or expired."
) => new InvalidApiKeyError({ message });

export const forbiddenScopeError = (scope: string) =>
  new ForbiddenScopeError({
    message: `This API key is missing the ${scope} scope.`,
  });

export const planRequiresUpgradeError = (
  message = "The Public API requires the Starter plan or higher."
) => new PlanRequiresUpgradeError({ message });

export const invalidRequestError = (message: string) =>
  new InvalidRequestError({ message });

export const notFoundError = (
  message = "The requested resource does not exist in this workspace."
) => new NotFoundError({ message });

export const rateLimitedError = (retryAfterSeconds: number) =>
  HttpApiSchema.withHeaders({
    body: new RateLimitedError({
      message: "Rate limit exceeded for this API key.",
    }),
    headers: { "retry-after": String(retryAfterSeconds) },
  });

export const internalError = (
  message = "The request could not be completed."
) => new InternalError({ message });

export const serviceUnavailableError = (
  message = "Rate limiting is temporarily unavailable; retry shortly."
) => new ServiceUnavailableError({ message });
