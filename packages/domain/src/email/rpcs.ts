import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { PolicyDeniedError } from "../policy";
import { InternalServerError, UnauthorizedError } from "../rpc-errors";
import { AuthMiddleware } from "../session-middleware";
import {
  EmailDeadLetter,
  EmailDeadLetterList,
  EmailDeliveryStats,
  EmailDeliveryStatsResult,
  EmailSuppressed,
  EmailSuppressedDelete,
  EmailSuppressedList,
} from "./schema";

const EmailAdminServiceErrors = Schema.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
]);

export class EmailAdminRpcs extends RpcGroup.make(
  Rpc.make("EmailSuppressedList", {
    payload: EmailSuppressedList,
    success: Schema.Array(EmailSuppressed),
    error: EmailAdminServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("EmailSuppressedDelete", {
    payload: EmailSuppressedDelete,
    success: Schema.Struct({ deleted: Schema.Boolean }),
    error: EmailAdminServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("EmailDeadLetterList", {
    payload: EmailDeadLetterList,
    success: Schema.Array(EmailDeadLetter),
    error: EmailAdminServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("EmailDeliveryStats", {
    payload: EmailDeliveryStats,
    success: EmailDeliveryStatsResult,
    error: EmailAdminServiceErrors,
  }).middleware(AuthMiddleware)
) {}
