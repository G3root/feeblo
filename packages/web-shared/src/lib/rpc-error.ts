import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export type ParsedRpcError =
  | {
      readonly cause: Cause.Cause<unknown>;
      readonly kind: "rpc";
      readonly message: string;
    }
  | {
      readonly kind: "unexpected";
      readonly message: string;
    };

export class RpcError extends Error {
  override readonly cause: Cause.Cause<unknown>;

  constructor(cause: Cause.Cause<unknown>) {
    super("RPC request failed", { cause });
    this.name = "RpcError";
    this.cause = cause;
  }
}

const UserFacingErrorSchema = Schema.Struct({
  _tag: Schema.String,
  reason: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
});

const decodeUserFacingError = Schema.decodeUnknownOption(UserFacingErrorSchema);

const ALLOWED_USER_FACING_TAGS = new Set<string>([
  "PolicyDenied",
  "BadRequestError",
  "NotFoundError",
  "UnauthorizedError",
  "BoardNotFoundError",
  "CompanyNotFoundError",
  "CompanyAlreadyExistsError",
  "ContactNotFoundError",
  "ContactAlreadyExistsError",
  "DataValidationError",
  "PostAlreadyExistsError",
  "AttributeDefinitionNotFoundError",
  "OgImageRequestValidationError",
  "OgImageSiteNotFoundError",
  "OgImagePostNotFoundError",
  "ProfanityError",
  "ReservedSubdomainError",
  "UploadLimitError",
  "FailedToCreateCheckoutError",
  "FailedToCreatePortalError",
]);

function extractUserMessage(cause: unknown): string | undefined {
  const decoded = decodeUserFacingError(cause);
  if (Option.isNone(decoded)) {
    return undefined;
  }
  const error = decoded.value;
  if (!ALLOWED_USER_FACING_TAGS.has(error._tag)) {
    return undefined;
  }
  const reason = error.reason?.trim();
  if (reason) {
    return reason;
  }
  const message = error.message?.trim();
  if (message) {
    return message;
  }
  return undefined;
}

function getCauseMessage(cause: Cause.Cause<unknown>): string | undefined {
  // Effect's canonical API: extract the first typed failure, if any.
  // For RpcError the cause is a Cause<E> where E is a tagged domain error
  // like PolicyDeniedError ({ _tag: "PolicyDenied", reason: string }).
  const failureOption = Cause.findErrorOption(cause);
  if (Option.isSome(failureOption)) {
    const message = extractUserMessage(failureOption.value);
    if (message) {
      return message;
    }
  }
  return undefined;
}

/**
 * Safely converts an unknown value thrown by `fetchRpc` into UI-safe copy.
 *
 * Extracts a user-facing `reason` / `message` from known domain failures
 * (e.g. `PolicyDeniedError`, `BadRequestError`) and falls back to the
 * provided safe default for unexpected or internal errors.
 *
 * Declared RPC failures that are handled explicitly should still be caught
 * in the Effect error channel with `Effect.catchTag` before calling
 * `fetchRpc`.
 */
export function parseRpcError<T>(
  error: T,
  fallback = "Something went wrong. Please try again."
): ParsedRpcError {
  if (error instanceof RpcError) {
    const message = getCauseMessage(error.cause) ?? fallback;
    return { cause: error.cause, kind: "rpc", message };
  }

  if (Cause.isCause(error)) {
    const message = getCauseMessage(error) ?? fallback;
    return { cause: error, kind: "rpc", message };
  }

  return { kind: "unexpected", message: fallback };
}
