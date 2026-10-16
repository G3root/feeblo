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

export const AttributeDefinitionRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* AttributeDefinitionRepository;
  const attributeDefinitionPolicy = yield* AttributeDefinitionPolicy;

  return {
    ListContactAttributeDefinitions: (args: TContactAttributeDefinitionList) =>
      repository
        .findContactAttributeDefinitions(args.organizationId)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("ContactAttributeDefinition", "select")
        ),
    CreateContactAttributeDefinition: (
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
    UpdateContactAttributeDefinition: (
      args: TContactAttributeDefinitionUpdate
    ) =>
      repository
        .updateContactAttributeDefinition(args)
        .pipe(
          Policy.withPolicy(attributeDefinitionPolicy.canUpdateContact(args)),
          withRemapDbErrors("ContactAttributeDefinition", "update")
        ),
    DeleteContactAttributeDefinition: (
      args: TContactAttributeDefinitionDelete
    ) =>
      repository
        .deleteContactAttributeDefinition(args)
        .pipe(
          Policy.withPolicy(attributeDefinitionPolicy.canDeleteContact(args)),
          withRemapDbErrors("ContactAttributeDefinition", "delete")
        ),
    ListCompanyAttributeDefinitions: (args: TCompanyAttributeDefinitionList) =>
      repository
        .findCompanyAttributeDefinitions(args.organizationId)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("CompanyAttributeDefinition", "select")
        ),
    CreateCompanyAttributeDefinition: (
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
    UpdateCompanyAttributeDefinition: (
      args: TCompanyAttributeDefinitionUpdate
    ) =>
      repository
        .updateCompanyAttributeDefinition(args)
        .pipe(
          Policy.withPolicy(attributeDefinitionPolicy.canUpdateCompany(args)),
          withRemapDbErrors("CompanyAttributeDefinition", "update")
        ),
    DeleteCompanyAttributeDefinition: (
      args: TCompanyAttributeDefinitionDelete
    ) =>
      repository
        .deleteCompanyAttributeDefinition(args)
        .pipe(
          Policy.withPolicy(attributeDefinitionPolicy.canDeleteCompany(args)),
          withRemapDbErrors("CompanyAttributeDefinition", "delete")
        ),
    ListContactAttributeValues: (args: TContactAttributeValueList) =>
      repository
        .findContactAttributeValues(args.organizationId)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("ContactAttributeValue", "select")
        ),
    UpdateContactAttributeValue: (args: TContactAttributeValueUpdate) =>
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
        return yield* repository.updateContactAttributeValue(args).pipe(
          // A strict update that matched nothing means the id names no value
          // row of this contact under this attribute — a stale or mismatched
          // caller id, not a server fault.
          Effect.catchTag("FailedToUpsertAttributeValueError", () =>
            Effect.fail(
              new BadRequestError({ message: "Attribute value not found" })
            )
          )
        );
      }).pipe(
        Policy.withPolicy(
          Policy.all(
            Policy.hasMembership(args.organizationId),
            // Writing contact attribute values writes contact data, so it must
            // require the same grant as UpdateContact; otherwise a contributor
            // with no CRM grants could overwrite SSO-synced attribute values.
            Policy.canPermission(args.organizationId, "contacts.update"),
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
    ListCompanyAttributeValues: (args: TCompanyAttributeValueList) =>
      repository
        .findCompanyAttributeValues(args.organizationId)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("CompanyAttributeValue", "select")
        ),
    UpdateCompanyAttributeValue: (args: TCompanyAttributeValueUpdate) =>
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
        return yield* repository.updateCompanyAttributeValue(args).pipe(
          // A strict update that matched nothing means the id names no value
          // row of this company under this attribute — a stale or mismatched
          // caller id, not a server fault.
          Effect.catchTag("FailedToUpsertAttributeValueError", () =>
            Effect.fail(
              new BadRequestError({ message: "Attribute value not found" })
            )
          )
        );
      }).pipe(
        Policy.withPolicy(
          Policy.all(
            Policy.hasMembership(args.organizationId),
            // Writing company attribute values writes company data, so it must
            // require the same grant as UpdateCompany; otherwise a contributor
            // with no CRM grants could overwrite SSO-synced attribute values.
            Policy.canPermission(args.organizationId, "companies.update"),
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
