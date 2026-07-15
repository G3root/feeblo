import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Policy from "../policy";
import { withRemapDbErrors } from "../rpc-errors";
import { ContactNotFoundError } from "./errors";
import { ContactPolicy } from "./policies";
import { ContactRepository } from "./repository";
import { ContactRpcs } from "./rpcs";
import type {
  TContactCreate,
  TContactDelete,
  TContactList,
  TContactUpdate,
  TContactUpsert,
} from "./schema";

export const ContactRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* ContactRepository;
  const contactPolicy = yield* ContactPolicy;

  return {
    ContactList: (args: TContactList) =>
      repository
        .findManyContacts(args.organizationId)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Contact", "select")
        ),

    ContactUpsert: (args: TContactUpsert) =>
      repository
        .upsertContact(args)
        .pipe(
          Effect.map(Option.getOrNull),
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Contact", "create")
        ),

    ContactCreate: (args: TContactCreate) =>
      repository
        .create(args)
        .pipe(
          Policy.withPolicy(contactPolicy.canCreate(args.organizationId)),
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
  Layer.provide(ContactRepository.layer)
);
