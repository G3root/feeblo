import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import { InternalServerError, UnauthorizedError } from "../rpc-errors";

/**
 * The failure vocabulary every reaction RPC publishes.
 *
 * One union for both targets. A reaction can only fail three ways — the caller
 * is not signed in, the workspace policy refuses them, or the write broke — and
 * the two per-target copies that existed were byte-identical, which is the
 * shape a drift starts from: one target gains a failure the other does not, and
 * the client's error handling becomes target-dependent for no reason.
 */
export const ReactionServiceErrors = Schema.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
]);
