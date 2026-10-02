import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { AuthMiddleware } from "../session-middleware";
import { CompanyServiceErrors } from "./errors";
import {
  Company,
  CompanyCreate,
  CompanyDelete,
  CompanyList,
  CompanyUpdate,
} from "./schema";

export class CompanyRpcs extends RpcGroup.make(
  Rpc.make("CompanyList", {
    success: Schema.Array(Company),
    payload: CompanyList,
    error: CompanyServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("CompanyCreate", {
    success: Company,
    payload: CompanyCreate,
    error: CompanyServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("CompanyUpdate", {
    success: Company,
    payload: CompanyUpdate,
    error: CompanyServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("CompanyDelete", {
    success: Schema.Void,
    payload: CompanyDelete,
    error: CompanyServiceErrors,
  }).middleware(AuthMiddleware)
) {}
