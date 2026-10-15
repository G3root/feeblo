import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { AuthMiddleware } from "../session-middleware";
import { JwtSecretServiceErrors } from "./errors";
import {
  JwtSecretList,
  JwtSecretRevoke,
  JwtSecretRotate,
  JwtSecretWithSecret,
} from "./schema";

export class JwtSecretRpcs extends RpcGroup.make(
  Rpc.make("RevokeJwtSecret", {
    success: Schema.Void,
    payload: JwtSecretRevoke,
    error: JwtSecretServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("RotateJwtSecret", {
    success: Schema.Void,
    payload: JwtSecretRotate,
    error: JwtSecretServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ListJwtSecrets", {
    success: Schema.Array(JwtSecretWithSecret),
    payload: JwtSecretList,
    error: JwtSecretServiceErrors,
  }).middleware(AuthMiddleware)
) {}
