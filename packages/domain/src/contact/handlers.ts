import { transaction } from "@feeblo/db";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { AttributeDefinitionRepository } from "../attribute-definition/repository";
import { validateAttributeValueEffect } from "../attribute-definition/validation";
import { CompanyRepository } from "../company/repository";
import { createCrmEntry } from "../crm-entry/intake";
import { EmailSubscriptionRepository } from "../email-subscription/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import { consumeDashboardRateLimit } from "../rate-limit";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { UserRepository } from "../user/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { ContactNotFoundError, FailedToCreateContactError } from "./errors";
import { ContactPolicy } from "./policies";
import { type ContactSearchArgs, ContactRepository } from "./repository";
import { ContactRpcs } from "./rpcs";
import type {
  TContactCreate,
  TContactCreateEligibility,
  TContactDelete,
  TContactList,
  TContactSearch,
  TContactUnsubscribe,
  TContactUpdate,
} from "./schema";

export const ContactRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* ContactRepository;
  const attributeDefinitionRepository = yield* AttributeDefinitionRepository;
  const companyRepository = yield* CompanyRepository;
  const contactPolicy = yield* ContactPolicy;
  const emailSubscriptions = yield* EmailSubscriptionRepository;
  const entitlementPolicy = yield* EntitlementPolicy;
  const userRepository = yield* UserRepository;

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

    /**
     * Answers whether one more CRM entry fits the plan, for the picker's
     * create-new-customer row. It reads the same two counts the write path
     * reads and shares the picker's read rate limit; the write path still
     * decides inside its transaction, so this is a hint that can safely go
     * stale.
     */
    ContactCreateEligibility: (args: TContactCreateEligibility) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        yield* consumeDashboardRateLimit({
          key: `contact-search:${args.organizationId}:${session.session.userId}`,
          name: "contact-search",
        });
        const [contacts, companies] = yield* Effect.all([
          repository.countByOrganizationId(args.organizationId),
          companyRepository.countByOrganizationId(args.organizationId),
        ]);
        const canCreate = yield* entitlementPolicy
          .canCreateCrmEntry({
            organizationId: args.organizationId,
            crmEntryCount: Effect.succeed(contacts + companies),
          })
          .pipe(
            Effect.as(true),
            Effect.catchTag("PolicyDenied", () => Effect.succeed(false))
          );
        return { canCreate };
      }).pipe(
        Policy.withPolicy(Policy.hasMembership(args.organizationId)),
        withRemapDbErrors("Contact", "select")
      ),

    ContactCreate: (args: TContactCreate) =>
      createCrmEntry({
        organizationId: args.organizationId,
        insert: Effect.gen(function* () {
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
        }),
      }).pipe(
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

    ContactUnsubscribe: (args: TContactUnsubscribe) =>
      Effect.gen(function* () {
        const contact = yield* repository.findById(args);
        if (Option.isNone(contact)) {
          return yield* new ContactNotFoundError({
            message: "Contact not found",
          });
        }
        const email = contact.value.email;
        if (email !== null) {
          yield* emailSubscriptions.unsubscribeAllForEmail({
            email,
            now: yield* DateTime.nowAsDate,
            organizationId: args.organizationId,
          });
        }
      }).pipe(
        Policy.withPolicy(contactPolicy.canUpdate(args)),
        withRemapDbErrors("Contact", "update")
      ),

    ContactDelete: (args: TContactDelete) =>
      Effect.gen(function* () {
        const deleted = yield* transaction(
          Effect.gen(function* () {
            const contact = yield* repository.delete(args);
            if (Option.isNone(contact)) {
              return contact;
            }
            // The linked synthetic account goes with the contact when nothing
            // refers to it any more; attributed content keeps it alive.
            if (contact.value.userId !== null) {
              yield* userRepository.deleteShadowUserIfUnreferenced(
                contact.value.userId
              );
            }
            return contact;
          })
        );
        if (Option.isNone(deleted)) {
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
  Layer.provide(ContactRepository.layer),
  Layer.provide(AttributeDefinitionRepository.layer),
  Layer.provide(CompanyRepository.layer),
  Layer.provide(EmailSubscriptionRepository.layer),
  Layer.provide(UserRepository.layer)
);
