import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import { PostNotFoundError } from "../post/errors";
import { InternalServerError, UnauthorizedError } from "../rpc-errors";

/**
 * The dashboard read's failure surface.
 *
 * A post outside the caller's workspace is `PostNotFoundError`, not a policy
 * denial: the read filters by both ids, so the two cases are the same fact from
 * the caller's side and the answer should not tell them apart.
 */
export const PostTrafficServiceErrors = Schema.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  PostNotFoundError,
]);
