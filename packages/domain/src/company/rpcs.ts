import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { AuthMiddleware } from "../session-middleware";
import { CompanyServiceErrors } from "./errors";
import { Company, CompanyList, CompanyUpsert } from "./schema";

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
  }).middleware(AuthMiddleware)
) {}
