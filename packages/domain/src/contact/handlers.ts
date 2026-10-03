import { transaction } from "@feeblo/db";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { AttributeDefinitionRepository } from "../attribute-definition/repository";
import { validateAttributeValueEffect } from "../attribute-definition/validation";
import { CompanyRepository } from "../company/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import { consumeDashboardRateLimit } from "../rate-limit";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { WorkspaceRepository } from "../workspace/repository";
import { ContactNotFoundError, FailedToCreateContactError } from "./errors";
import { ContactPolicy } from "./policies";
import { type ContactSearchArgs, ContactRepository } from "./repository";
import { ContactRpcs } from "./rpcs";
import type {
  TContactCreate,
  TContactDelete,
  TContactList,
  TContactSearch,
  TContactUpdate,
} from "./schema";

export const ContactRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* ContactRepository;
  const attributeDefinitionRepository = yield* AttributeDefinitionRepository;
  const companyRepository = yield* CompanyRepository;
  const workspaceRepository = yield* WorkspaceRepository;
  const entitlementPolicy = yield* EntitlementPolicy;
  const contactPolicy = yield* ContactPolicy;

  return {
    ContactList: (args: TContactList) =>
      repository
        .findManyContacts(args.organizationId)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Contact", "select")
        ),

    ContactSearch: (args: TContactSearch) => {
      const searchArgs: ContactSearchArgs = {
        organizationId: args.organizationId,
        query: args.query.trim(),
      };
      if (args.postId !== undefined) {
        searchArgs.postId = args.postId;
      }
      if (args.limit !== undefined) {
        searchArgs.limit = args.limit;
      }

      return Effect.gen(function* () {
        // The combobox debounces client-side; the server enforces a minimum
        // useful query length so stray keystrokes cost nothing.
        if (searchArgs.query.length < 2) {
          return [];
        }
        const session = yield* CurrentSession;
        // Dashboard read-level rate limit for the picker (see
        // plan-on-behalf.md); keyed by the searching member.
        yield* consumeDashboardRateLimit({
          key: `contact-search:${args.organizationId}:${session.session.userId}`,
          name: "contact-search",
        });
        return yield* repository.search(searchArgs);
      }).pipe(
        Policy.withPolicy(Policy.hasMembership(args.organizationId)),
        withRemapDbErrors("Contact", "select")
      );
    },

    ContactCreate: (args: TContactCreate) =>
      transaction(
        Effect.gen(function* () {
          // First lock, first: the workspace row is held for the whole write,
          // and the CRM plan count below is only authoritative while it is —
          // two creates arriving near the cap cannot both see room. The Public
          // API's company create takes the same lock in the same position, so
          // the two surfaces enforce one limit the same way. The lock comes
          // before any child insert because each insert's foreign-key check
          // holds a key-share on this row that would otherwise deadlock
          // against it.
          yield* workspaceRepository.lockOrganization(args.organizationId);
          yield* entitlementPolicy.canCreateCrmEntry({
            organizationId: args.organizationId,
            crmEntryCount: companyRepository.countCrmEntries(
              args.organizationId
            ),
          });

          const attributeValues = args.attributeValues ?? [];
          const definitions =
            yield* attributeDefinitionRepository.findContactAttributeDefinitions(
              args.organizationId
            );
          const definitionsById = new Map(
            definitions.map((definition) => [definition.id, definition])
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

          const contact = yield* repository.create(args);
          yield* Effect.forEach(args.attributeValues ?? [], (attributeValue) =>
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
                .upsertContactAttributeValue({
                  ...attributeValue,
                  contactId: contact.id,
                  organizationId: args.organizationId,
                })
                .pipe(
                  Effect.catchTag("FailedToUpsertAttributeValueError", () =>
                    Effect.fail(new FailedToCreateContactError())
                  )
                );
            })
          );
          return contact;
        })
      ).pipe(
        Policy.withPolicy(contactPolicy.canCreate(args)),
        withRemapDbErrors("Contact", "create")
      ),

    ContactUpdate: (args: TContactUpdate) =>
      Effect.gen(function* () {
        const contact = yield* repository.update(args);
        if (Option.isNone(contact)) {
          return yield* new ContactNotFoundError({
            message: "Contact not found",
          });
        }
        return contact.value;
      }).pipe(
        Policy.withPolicy(contactPolicy.canUpdate(args)),
        withRemapDbErrors("Contact", "update")
      ),

    ContactDelete: (args: TContactDelete) =>
      Effect.gen(function* () {
        const contact = yield* repository.delete(args);
        if (Option.isNone(contact)) {
          return yield* new ContactNotFoundError({
            message: "Contact not found",
          });
        }
      }).pipe(
        Policy.withPolicy(contactPolicy.canDelete(args)),
        withRemapDbErrors("Contact", "delete")
      ),
  };
});

export const ContactRpcHandlers = ContactRpcs.toLayer(
  ContactRpcHandlersEffect
).pipe(
  Layer.provide(ContactPolicy.layer),
  Layer.provide(EntitlementPolicy.layer),
  Layer.provide(WorkspaceRepository.layer),
  Layer.provide(CompanyRepository.layer),
  Layer.provide(ContactRepository.layer),
  Layer.provide(AttributeDefinitionRepository.layer)
);
