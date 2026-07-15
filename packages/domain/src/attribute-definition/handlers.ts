import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { withRemapDbErrors } from "../rpc-errors";
import { AttributeDefinitionPolicy } from "./policies";
import { AttributeDefinitionRepository } from "./repository";
import { AttributeDefinitionRpcs } from "./rpcs";
import type {
  TCompanyAttributeDefinitionCreate,
  TCompanyAttributeDefinitionDelete,
  TCompanyAttributeDefinitionList,
  TCompanyAttributeDefinitionUpdate,
  TCompanyAttributeValueList,
  TContactAttributeDefinitionCreate,
  TContactAttributeDefinitionDelete,
  TContactAttributeDefinitionList,
  TContactAttributeDefinitionUpdate,
  TContactAttributeValueList,
} from "./schema";

export const AttributeDefinitionRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* AttributeDefinitionRepository;
  const attributeDefinitionPolicy = yield* AttributeDefinitionPolicy;

  return {
    ContactAttributeDefinitionList: (args: TContactAttributeDefinitionList) =>
      repository
        .findContactAttributeDefinitions(args.organizationId)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("ContactAttributeDefinition", "select")
        ),
    ContactAttributeDefinitionCreate: (
      args: TContactAttributeDefinitionCreate
    ) =>
      repository
        .createContactAttributeDefinition(args)
        .pipe(
          Policy.withPolicy(
            attributeDefinitionPolicy.canCreateContact(args.organizationId)
          ),
          withRemapDbErrors("ContactAttributeDefinition", "create")
        ),
    ContactAttributeDefinitionUpdate: (
      args: TContactAttributeDefinitionUpdate
    ) =>
      repository
        .updateContactAttributeDefinition(args)
        .pipe(
          Policy.withPolicy(attributeDefinitionPolicy.canUpdateContact(args)),
          withRemapDbErrors("ContactAttributeDefinition", "update")
        ),
    ContactAttributeDefinitionDelete: (
      args: TContactAttributeDefinitionDelete
    ) =>
      repository
        .deleteContactAttributeDefinition(args)
        .pipe(
          Policy.withPolicy(attributeDefinitionPolicy.canDeleteContact(args)),
          withRemapDbErrors("ContactAttributeDefinition", "delete")
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
          Policy.withPolicy(
            attributeDefinitionPolicy.canCreateCompany(args.organizationId)
          ),
          withRemapDbErrors("CompanyAttributeDefinition", "create")
        ),
    CompanyAttributeDefinitionUpdate: (
      args: TCompanyAttributeDefinitionUpdate
    ) =>
      repository
        .updateCompanyAttributeDefinition(args)
        .pipe(
          Policy.withPolicy(attributeDefinitionPolicy.canUpdateCompany(args)),
          withRemapDbErrors("CompanyAttributeDefinition", "update")
        ),
    CompanyAttributeDefinitionDelete: (
      args: TCompanyAttributeDefinitionDelete
    ) =>
      repository
        .deleteCompanyAttributeDefinition(args)
        .pipe(
          Policy.withPolicy(attributeDefinitionPolicy.canDeleteCompany(args)),
          withRemapDbErrors("CompanyAttributeDefinition", "delete")
        ),
    ContactAttributeValueList: (args: TContactAttributeValueList) =>
      repository
        .findContactAttributeValues(args.contactId)
        .pipe(withRemapDbErrors("ContactAttributeValue", "select")),
    CompanyAttributeValueList: (args: TCompanyAttributeValueList) =>
      repository
        .findCompanyAttributeValues(args.companyId)
        .pipe(withRemapDbErrors("CompanyAttributeValue", "select")),
  };
});

export const AttributeDefinitionRpcHandlers = AttributeDefinitionRpcs.toLayer(
  AttributeDefinitionRpcHandlersEffect
).pipe(
  Layer.provide(
    AttributeDefinitionPolicy.layer.pipe(
      Layer.provideMerge(AttributeDefinitionRepository.layer)
    )
  )
);
