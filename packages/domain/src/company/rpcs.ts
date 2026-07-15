import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { AuthMiddleware } from "../session-middleware";
import { CompanyServiceErrors } from "./errors";
import {
  Company,
  CompanyCreate,
  CompanyDelete,
  CompanyList,
  CompanyUpdate,
  CompanyUpsert,
} from "./schema";

export class CompanyRpcs extends RpcGroup.make(
  Rpc.make("CompanyList", {
    success: Schema.Array(Company),
    payload: CompanyList,
    error: CompanyServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("CompanyUpsert", {
    success: Company,
    payload: CompanyUpsert,
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
