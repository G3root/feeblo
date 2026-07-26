import * as S from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import { InternalServerError, UnauthorizedError } from "../rpc-errors";

export const NotificationServiceErrors = S.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
]);
