import * as Schema from "effect/Schema";

import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { AuthMiddleware } from "../session-middleware";
import { JwtSecretServiceErrors } from "./errors";
import {
  JwtSecretList,
  JwtSecretRevoke,
  JwtSecretRotate,
  JwtSecretWithSecret,
} from "./schema";

export class JwtSecretRpcs extends RpcGroup.make(
  Rpc.make("JwtSecretRevoke", {
    success: Schema.Void,
    payload: JwtSecretRevoke,
    error: JwtSecretServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("JwtSecretRotate", {
    success: JwtSecretWithSecret,
    payload: JwtSecretRotate,
    error: JwtSecretServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("JwtSecretList", {
    success: Schema.Array(JwtSecretWithSecret),
    payload: JwtSecretList,
    error: JwtSecretServiceErrors,
  }).middleware(AuthMiddleware)
) {}
