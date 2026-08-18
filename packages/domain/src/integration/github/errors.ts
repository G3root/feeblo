import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../../policy";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
} from "../../rpc-errors";

/** RPC failures that can be safely rendered to GitHub integration users. */
export const GitHubIntegrationErrors = Schema.Union([
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PolicyDeniedError,
  UnauthorizedError,
]);
export type GitHubIntegrationError = Schema.Schema.Type<
  typeof GitHubIntegrationErrors
>;
