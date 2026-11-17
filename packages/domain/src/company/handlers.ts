import { transaction } from "@feeblo/db";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { AttributeDefinitionRepository } from "../attribute-definition/repository";
import { validateAttributeValueEffect } from "../attribute-definition/validation";
import { actorFromSession } from "../audit-log/attribution";
import { AuditLogRecorder } from "../audit-log/recorder";
import { ContactRepository } from "../contact/repository";
import { createCrmEntry } from "../crm-entry/intake";
import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { WorkspaceRepository } from "../workspace/repository";
import { CompanyNotFoundError, FailedToCreateCompanyError } from "./errors";
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
  const attributeDefinitionRepository = yield* AttributeDefinitionRepository;
  const companyPolicy = yield* CompanyPolicy;

  return {
    ListCompanies: (args: TCompanyList) =>
      repository
        .findManyCompanies(args.organizationId)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Company", "select")
        ),
    CreateCompany: (args: TCompanyCreate) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;

        return yield* createCrmEntry({
          organizationId: args.organizationId,
          insert: Effect.gen(function* () {
            const attributeValues = args.attributeValues ?? [];

            // Share-locked for this transaction: the required-value check, the
            // per-value validation and the upserts below all read one snapshot,
            // so a definition that becomes required while the create runs cannot
            // let a supplied `null` through.
            const definitions =
              yield* attributeDefinitionRepository.findCompanyAttributeDefinitionsForShare(
                args.organizationId
              );

            yield* Effect.forEach(
              definitions.filter(
                (definition) =>
                  definition.isRequired &&
                  !attributeValues.some(
                    (attributeValue) =>
                      attributeValue.attributeId === definition.id
                  )
              ),
              (definition) => validateAttributeValueEffect(definition, null)
            );

            const company = yield* repository.create(args);

            // The definitions were just read for this workspace, so the id map is
            // the existence check: looking each attribute id up again (twice —
            // once as a policy check, once for the row) cost this create two extra
            // round trips per value, inside the transaction holding the lock.
            const definitionsById = new Map(
              definitions.map((definition) => [definition.id, definition])
            );

            yield* Effect.forEach(
              args.attributeValues ?? [],
              (attributeValue) =>
                Effect.gen(function* () {
                  const definition = definitionsById.get(
                    attributeValue.attributeId
                  );

                  if (definition === undefined) {
                    return yield* new Policy.PolicyDeniedError();
                  }

                  yield* validateAttributeValueEffect(
                    definition,
                    attributeValue.value
                  );
                  yield* attributeDefinitionRepository
                    .upsertCompanyAttributeValue({
                      ...attributeValue,
                      companyId: company.id,
                      organizationId: args.organizationId,
                    })
                    .pipe(
                      Effect.catchTag("FailedToUpsertAttributeValueError", () =>
                        Effect.fail(new FailedToCreateCompanyError())
                      )
                    );
                })
            );
            // Inside `createCrmEntry`'s transaction, so the company, its
            // attribute values and the entry commit together.
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "company.created",
              resourceId: company.id,
              metadata: { name: company.name },
            });

            return company;
          }),
        });
      }).pipe(
        Policy.withPolicy(companyPolicy.canCreate(args.organizationId)),
        withRemapDbErrors("Company", "create")
      ),
    UpdateCompany: (args: TCompanyUpdate) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;

        const company = yield* transaction(
          Effect.gen(function* () {
            const updated = yield* repository.update(args);

            if (Option.isNone(updated)) {
              return updated;
            }

            // The update returns the row it wrote, not the one it replaced, so
            // the new name goes in `metadata` rather than posing as a diff
            // with an empty `before`.
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "company.updated",
              resourceId: args.id,
              metadata: { name: updated.value.name },
            });

            return updated;
          })
        );

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
    DeleteCompany: (args: TCompanyDelete) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;

        const deleted = yield* transaction(
          Effect.gen(function* () {
            const company = yield* repository.delete(args);

            if (Option.isNone(company)) {
              return company;
            }

            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "company.deleted",
              resourceId: args.id,
            });

            return company;
          })
        );

        if (Option.isNone(deleted)) {
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
  Layer.provide(EntitlementPolicy.layer),
  Layer.provide(WorkspaceRepository.layer),
  Layer.provide(ContactRepository.layer),
  Layer.provide(CompanyRepository.layer),
  Layer.provide(AttributeDefinitionRepository.layer),
  Layer.provide(AuditLogRecorder.layer)
);
