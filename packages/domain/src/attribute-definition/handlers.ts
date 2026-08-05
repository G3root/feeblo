import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { BadRequestError, withRemapDbErrors } from "../rpc-errors";
import { AttributeDefinitionPolicy } from "./policies";
import { AttributeDefinitionRepository } from "./repository";
import { AttributeDefinitionRpcs } from "./rpcs";
import type {
  TCompanyAttributeDefinitionCreate,
  TCompanyAttributeDefinitionDelete,
  TCompanyAttributeDefinitionList,
  TCompanyAttributeDefinitionUpdate,
  TCompanyAttributeValueList,
  TCompanyAttributeValueUpdate,
  TContactAttributeDefinitionCreate,
  TContactAttributeDefinitionDelete,
  TContactAttributeDefinitionList,
  TContactAttributeDefinitionUpdate,
  TContactAttributeValueList,
  TContactAttributeValueUpdate,
} from "./schema";
import { validateAttributeValueEffect } from "./validation";

//TODO FIX later
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
        .findContactAttributeValues(args.organizationId)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("ContactAttributeValue", "select")
        ),
    ContactAttributeValueUpdate: (args: TContactAttributeValueUpdate) =>
      Effect.gen(function* () {
        const definition = yield* repository.findContactAttributeDefinitionById(
          contactAttributeDefinitionReference(args)
        );
        if (definition === undefined) {
          return yield* new BadRequestError({
            message: "Attribute definition not found",
          });
        }
        yield* validateAttributeValueEffect(definition, args.value);
        return yield* repository.updateContactAttributeValue(args);
      }).pipe(
        Policy.withPolicy(
          Policy.all(
            Policy.hasMembership(args.organizationId),
            Policy.policy(() =>
              repository.contactExists(args.contactId, args.organizationId)
            ),
            Policy.policy(() =>
              repository.contactAttributeDefinitionExists(
                contactAttributeDefinitionReference(args)
              )
            )
          )
        ),
        withRemapDbErrors("ContactAttributeValue", "update")
      ),
    CompanyAttributeValueList: (args: TCompanyAttributeValueList) =>
      repository
        .findCompanyAttributeValues(args.organizationId)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("CompanyAttributeValue", "select")
        ),
    CompanyAttributeValueUpdate: (args: TCompanyAttributeValueUpdate) =>
      Effect.gen(function* () {
        const definition = yield* repository.findCompanyAttributeDefinitionById(
          companyAttributeDefinitionReference(args)
        );
        if (definition === undefined) {
          return yield* new BadRequestError({
            message: "Attribute definition not found",
          });
        }
        yield* validateAttributeValueEffect(definition, args.value);
        return yield* repository.updateCompanyAttributeValue(args);
      }).pipe(
        Policy.withPolicy(
          Policy.all(
            Policy.hasMembership(args.organizationId),
            Policy.policy(() =>
              repository.companyExists(args.companyId, args.organizationId)
            ),
            Policy.policy(() =>
              repository.companyAttributeDefinitionExists(
                companyAttributeDefinitionReference(args)
              )
            )
          )
        ),
        withRemapDbErrors("CompanyAttributeValue", "update")
      ),
  };
});

function contactAttributeDefinitionReference(
  args: TContactAttributeValueUpdate
): TContactAttributeDefinitionDelete {
  return {
    id: args.attributeId,
    organizationId: args.organizationId,
  };
}

function companyAttributeDefinitionReference(
  args: TCompanyAttributeValueUpdate
): TCompanyAttributeDefinitionDelete {
  return {
    id: args.attributeId,
    organizationId: args.organizationId,
  };
}

export const AttributeDefinitionRpcHandlers = AttributeDefinitionRpcs.toLayer(
  AttributeDefinitionRpcHandlersEffect
).pipe(
  Layer.provide(
    AttributeDefinitionPolicy.layer.pipe(
      Layer.provideMerge(AttributeDefinitionRepository.layer)
    )
  )
);
