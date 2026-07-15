import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Policy from "../policy";
import { withRemapDbErrors } from "../rpc-errors";
import { ContactRepository } from "./repository";
import { ContactRpcs } from "./rpcs";
import type {
  TContactAttributeDefinitionCreate,
  TContactAttributeDefinitionList,
  TContactAttributeValueList,
  TContactList,
  TContactUpsert,
} from "./schema";

export const ContactRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* ContactRepository;

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
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("ContactAttributeDefinition", "create")
        ),

    //TODOO add permission
    ContactAttributeValueList: (args: TContactAttributeValueList) =>
      repository
        .findContactAttributeValues(args.contactId)
        .pipe(withRemapDbErrors("ContactAttributeValue", "select")),
  };
});

export const ContactRpcHandlers = ContactRpcs.toLayer(
  ContactRpcHandlersEffect
).pipe(Layer.provide(ContactRepository.layer));
