import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
} from "../rpc-errors";

export class FailedToSetHelpCenterArticleFeedbackError extends Schema.TaggedError<FailedToSetHelpCenterArticleFeedbackError>()(
  "FailedToSetHelpCenterArticleFeedbackError",
  {},
  {
    httpApiStatus: 500,
    identifier: "FailedToSetHelpCenterArticleFeedbackError",
  }
) {}

export const HelpCenterArticleFeedbackServiceErrors = Schema.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  BadRequestError,
  NotFoundError,
  FailedToSetHelpCenterArticleFeedbackError,
]);
