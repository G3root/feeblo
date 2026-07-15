import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { withRemapDbErrors } from "../rpc-errors";
import { CompanyRepository } from "./repository";
import { CompanyRpcs } from "./rpcs";
import type {
  TCompanyAttributeDefinitionCreate,
  TCompanyAttributeDefinitionList,
  TCompanyAttributeValueList,
  TCompanyList,
  TCompanyUpsert,
} from "./schema";

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
    CompanyAttributeDefinitionList: (args: TCompanyAttributeDefinitionList) =>
      repository
        .findCompanyAttributeDefinitions(args.organizationId)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("CompanyAttributeDefinition", "select")
        ),
    CompanyAttributeDefinitionCreate: (
      args: TCompanyAttributeDefinitionCreate
    ) =>
      repository
        .createCompanyAttributeDefinition(args)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("CompanyAttributeDefinition", "create")
        ),
    CompanyAttributeValueList: (args: TCompanyAttributeValueList) =>
      repository
        .findCompanyAttributeValues(args.companyId)
        .pipe(withRemapDbErrors("CompanyAttributeValue", "select")),
  };
});

export const CompanyRpcHandlers = CompanyRpcs.toLayer(
  CompanyRpcHandlersEffect
).pipe(Layer.provide(CompanyRepository.layer));
