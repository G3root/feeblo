import * as S from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";

export const NotificationServiceErrors = S.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  // A list request whose cursor does not decode is a caller mistake, and the
  // service answers it as one instead of restarting the page silently.
  BadRequestError,
]);
