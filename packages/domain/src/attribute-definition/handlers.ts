import { transaction } from "@feeblo/db";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { actorFromSession } from "../audit-log/attribution";
import { AuditLogRecorder } from "../audit-log/recorder";
import * as Policy from "../policy";
import { BadRequestError, withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
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
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        yield* transaction(
          Effect.gen(function* () {
            yield* repository.createContactAttributeDefinition(args);
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "attribute_definition.created",
              resourceId: args.id,
              // Both definition tables store the same resource type, so
              // `target` says which one the id belongs to.
              metadata: {
                target: "contact",
                name: args.name,
                type: args.type,
              },
            });
          })
        );
      }).pipe(
        Policy.withPolicy(
          attributeDefinitionPolicy.canCreateContact(args.organizationId)
        ),
        withRemapDbErrors("ContactAttributeDefinition", "create")
      ),
    UpdateContactAttributeDefinition: (
      args: TContactAttributeDefinitionUpdate
    ) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        yield* transaction(
          Effect.gen(function* () {
            yield* repository.updateContactAttributeDefinition(args);
            // The update returns nothing, so the new values go in `metadata`
            // rather than posing as a diff with an empty `before`.
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "attribute_definition.updated",
              resourceId: args.id,
              metadata: {
                target: "contact",
                name: args.name,
                isRequired: args.isRequired,
              },
            });
          })
        );
      }).pipe(
        Policy.withPolicy(attributeDefinitionPolicy.canUpdateContact(args)),
        withRemapDbErrors("ContactAttributeDefinition", "update")
      ),
    DeleteContactAttributeDefinition: (
      args: TContactAttributeDefinitionDelete
    ) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        yield* transaction(
          Effect.gen(function* () {
            yield* repository.deleteContactAttributeDefinition(args);
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "attribute_definition.deleted",
              resourceId: args.id,
              metadata: { target: "contact" },
            });
          })
        );
      }).pipe(
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
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        yield* transaction(
          Effect.gen(function* () {
            yield* repository.createCompanyAttributeDefinition(args);
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "attribute_definition.created",
              resourceId: args.id,
              metadata: {
                target: "company",
                name: args.name,
                type: args.type,
              },
            });
          })
        );
      }).pipe(
        Policy.withPolicy(
          attributeDefinitionPolicy.canCreateCompany(args.organizationId)
        ),
        withRemapDbErrors("CompanyAttributeDefinition", "create")
      ),
    UpdateCompanyAttributeDefinition: (
      args: TCompanyAttributeDefinitionUpdate
    ) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        yield* transaction(
          Effect.gen(function* () {
            yield* repository.updateCompanyAttributeDefinition(args);
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "attribute_definition.updated",
              resourceId: args.id,
              metadata: {
                target: "company",
                name: args.name,
                isRequired: args.isRequired,
              },
            });
          })
        );
      }).pipe(
        Policy.withPolicy(attributeDefinitionPolicy.canUpdateCompany(args)),
        withRemapDbErrors("CompanyAttributeDefinition", "update")
      ),
    DeleteCompanyAttributeDefinition: (
      args: TCompanyAttributeDefinitionDelete
    ) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        yield* transaction(
          Effect.gen(function* () {
            yield* repository.deleteCompanyAttributeDefinition(args);
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "attribute_definition.deleted",
              resourceId: args.id,
              metadata: { target: "company" },
            });
          })
        );
      }).pipe(
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
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;

        const definition = yield* repository.findContactAttributeDefinitionById(
          contactAttributeDefinitionReference(args)
        );

        if (definition === undefined) {
          return yield* new BadRequestError({
            message: "Attribute definition not found",
          });
        }

        yield* validateAttributeValueEffect(definition, args.value);

        return yield* transaction(
          Effect.gen(function* () {
            const updated = yield* repository
              .updateContactAttributeValue(args)
              .pipe(
                // A strict update that matched nothing means the id names no
                // value row of this contact under this attribute — a stale or
                // mismatched caller id, not a server fault.
                Effect.catchTag("FailedToUpsertAttributeValueError", () =>
                  Effect.fail(
                    new BadRequestError({
                      message: "Attribute value not found",
                    })
                  )
                )
              );

            // The catalog's resource is the definition, so `resourceId` is the
            // attribute and the contact rides in `metadata`. The value itself
            // stays out: this table is append-only, so a customer value
            // written here could never be corrected or removed — the value
            // row remains the record of the value.
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "attribute_definition.value_updated",
              resourceId: args.attributeId,
              metadata: {
                target: "contact",
                contactId: args.contactId,
                valueId: args.id,
              },
            });

            return updated;
          })
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
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;

        const definition = yield* repository.findCompanyAttributeDefinitionById(
          companyAttributeDefinitionReference(args)
        );

        if (definition === undefined) {
          return yield* new BadRequestError({
            message: "Attribute definition not found",
          });
        }

        yield* validateAttributeValueEffect(definition, args.value);

        return yield* transaction(
          Effect.gen(function* () {
            const updated = yield* repository
              .updateCompanyAttributeValue(args)
              .pipe(
                // A strict update that matched nothing means the id names no
                // value row of this company under this attribute — a stale or
                // mismatched caller id, not a server fault.
                Effect.catchTag("FailedToUpsertAttributeValueError", () =>
                  Effect.fail(
                    new BadRequestError({
                      message: "Attribute value not found",
                    })
                  )
                )
              );

            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "attribute_definition.value_updated",
              resourceId: args.attributeId,
              metadata: {
                target: "company",
                companyId: args.companyId,
                valueId: args.id,
              },
            });

            return updated;
          })
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
  ),
  Layer.provide(AuditLogRecorder.layer)
);
