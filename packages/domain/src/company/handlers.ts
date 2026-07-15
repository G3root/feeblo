import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { withRemapDbErrors } from "../rpc-errors";
import { CompanyRepository } from "./repository";
import { CompanyRpcs } from "./rpcs";
import type { TCompanyList, TCompanyUpsert } from "./schema";

export const CompanyRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* CompanyRepository;

  return {
    CompanyList: (args: TCompanyList) =>
      repository
        .findManyCompanies(args.organizationId)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Company", "select")
        ),
    CompanyUpsert: (args: TCompanyUpsert) =>
      repository
        .upsertCompany(args)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Company", "create")
        ),
  };
});

export const CompanyRpcHandlers = CompanyRpcs.toLayer(
  CompanyRpcHandlersEffect
).pipe(Layer.provide(CompanyRepository.layer));
