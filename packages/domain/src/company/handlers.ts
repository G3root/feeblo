import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Policy from "../policy";
import { withRemapDbErrors } from "../rpc-errors";
import { CompanyNotFoundError } from "./errors";
import { CompanyPolicy } from "./policies";
import { CompanyRepository } from "./repository";
import { CompanyRpcs } from "./rpcs";
import type {
  TCompanyCreate,
  TCompanyDelete,
  TCompanyList,
  TCompanyUpdate,
} from "./schema";

export const CompanyRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* CompanyRepository;
  const companyPolicy = yield* CompanyPolicy;

  return {
    CompanyList: (args: TCompanyList) =>
      repository
        .findManyCompanies(args.organizationId)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Company", "select")
        ),
    CompanyCreate: (args: TCompanyCreate) =>
      repository
        .create(args)
        .pipe(
          Policy.withPolicy(companyPolicy.canCreate(args.organizationId)),
          withRemapDbErrors("Company", "create")
        ),
    CompanyUpdate: (args: TCompanyUpdate) =>
      Effect.gen(function* () {
        const company = yield* repository.update(args);
        if (Option.isNone(company)) {
          return yield* new CompanyNotFoundError({
            message: "Company not found",
          });
        }
        return company.value;
      }).pipe(
        Policy.withPolicy(companyPolicy.canUpdate(args)),
        withRemapDbErrors("Company", "update")
      ),
    CompanyDelete: (args: TCompanyDelete) =>
      Effect.gen(function* () {
        const company = yield* repository.delete(args);
        if (Option.isNone(company)) {
          return yield* new CompanyNotFoundError({
            message: "Company not found",
          });
        }
      }).pipe(
        Policy.withPolicy(companyPolicy.canDelete(args)),
        withRemapDbErrors("Company", "delete")
      ),
  };
});

export const CompanyRpcHandlers = CompanyRpcs.toLayer(
  CompanyRpcHandlersEffect
).pipe(
  Layer.provide(CompanyPolicy.layer),
  Layer.provide(CompanyRepository.layer)
);
