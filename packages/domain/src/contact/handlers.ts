import { transaction } from "@feeblo/db";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { AttributeDefinitionRepository } from "../attribute-definition/repository";
import { validateAttributeValueEffect } from "../attribute-definition/validation";
import { actorFromSession } from "../audit-log/attribution";
import { AuditLogRecorder } from "../audit-log/recorder";
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
    ListContacts: (args: TContactList) =>
      repository
        .findManyContacts(args.organizationId)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Contact", "select")
        ),

    SearchContacts: (args: TContactSearch) => {
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
        const audit = yield* AuditLogRecorder;
        // Dashboard read-level rate limit for the picker (see
        // plan-on-behalf.md); keyed by the searching member.
        yield* consumeDashboardRateLimit({
          key: `contact-search:${args.organizationId}:${session.session.userId}`,
          name: "contact-search",
        });
        const results = yield* repository.search(searchArgs);

        // This is the audited contact read: it searches the whole CRM and
        // returns the full records it finds, while `ListContacts` serves a
        // page of one table. The search is already done when the entry is
        // written and there is no transaction to join, so a failed insert is
        // logged and given up rather than turning a completed read into an
        // error the client cannot act on. A search that found nothing moved no
        // data and is not recorded.
        if (results.length > 0) {
          yield* audit.recordBestEffort({
            organizationId: args.organizationId,
            actor: actorFromSession(session, args.organizationId),
            source: "dashboard",
            action: "contact.read",
            metadata: {
              query: searchArgs.query,
              resultCount: results.length,
              ...(searchArgs.postId !== undefined && {
                postId: searchArgs.postId,
              }),
            },
          });
        }

        return results;
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
    CheckContactCreateEligibility: (args: TContactCreateEligibility) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        yield* consumeDashboardRateLimit({
          key: `contact-search:${args.organizationId}:${session.session.userId}`,
          name: "contact-search",
        });

        // Same count the write path reads: contacts and companies are two
        // independent aggregates, so they resolve together rather than one
        // after the other.
        const [contacts, companies] = yield* Effect.all(
          [
            repository.countByOrganizationId(args.organizationId),
            companyRepository.countByOrganizationId(args.organizationId),
          ],
          { concurrency: "unbounded" }
        );

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

    CreateContact: (args: TContactCreate) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;

        return yield* createCrmEntry({
          organizationId: args.organizationId,
          insert: Effect.gen(function* () {
            const attributeValues = args.attributeValues ?? [];

            // Share-locked for this transaction, like the company create: the
            // required-value check, the per-value validation and the upserts
            // below all read one snapshot, so a definition that becomes required
            // while the create runs cannot let a supplied `null` through.
            const definitions =
              yield* attributeDefinitionRepository.findContactAttributeDefinitionsForShare(
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
            // Inside `createCrmEntry`'s transaction, so the contact, its
            // attribute values and the entry commit together.
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "contact.created",
              resourceId: contact.id,
              metadata: { email: contact.email, name: contact.name },
            });

            return contact;
          }),
        });
      }).pipe(
        Policy.withPolicy(contactPolicy.canCreate(args)),
        withRemapDbErrors("Contact", "create")
      ),

    UpdateContact: (args: TContactUpdate) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;

        const contact = yield* transaction(
          Effect.gen(function* () {
            const updated = yield* repository.update(args);

            if (Option.isNone(updated)) {
              return updated;
            }

            // The update returns the row it wrote, not the one it replaced, so
            // the new values go in `metadata` rather than posing as a diff
            // with an empty `before`.
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "contact.updated",
              resourceId: args.id,
              metadata: {
                email: updated.value.email,
                name: updated.value.name,
              },
            });

            return updated;
          })
        );

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

    UnsubscribeContact: (args: TContactUnsubscribe) =>
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

    DeleteContact: (args: TContactDelete) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;

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

            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "contact.deleted",
              resourceId: args.id,
              metadata: { userId: contact.value.userId },
            });

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
  Layer.provide(UserRepository.layer),
  Layer.provide(AuditLogRecorder.layer)
);
