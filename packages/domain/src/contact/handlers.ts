import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Policy from "../policy";
import { withRemapDbErrors } from "../rpc-errors";
import { ContactRepository } from "./repository";
import { ContactRpcs } from "./rpcs";
import type {
  TCompanyAttributeDefinitionCreate,
  TCompanyAttributeDefinitionList,
  TCompanyAttributeValueList,
  TCompanyList,
  TCompanyUpsert,
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

    CompanyList: (args: TCompanyList) =>
      repository
        .findManyCompanies(args.organizationId)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Company", "select")
        ),

    ContactUpsert: (args: TContactUpsert) =>
      repository
        .upsertContact(args)
        .pipe(
          Effect.map(Option.getOrNull),
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Contact", "create")
        ),

    CompanyUpsert: (args: TCompanyUpsert) =>
      repository
        .upsertCompany(args)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Company", "create")
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
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("CompanyAttributeDefinition", "create")
        ),

    //TODOO add permission
    ContactAttributeValueList: (args: TContactAttributeValueList) =>
      repository
        .findContactAttributeValues(args.contactId)
        .pipe(withRemapDbErrors("ContactAttributeValue", "select")),

    CompanyAttributeValueList: (args: TCompanyAttributeValueList) =>
      repository.findCompanyAttributeValues(args.companyId).pipe(
        //TODOO add permission
        withRemapDbErrors("CompanyAttributeValue", "select")
      ),
  };
});

export const ContactRpcHandlers = ContactRpcs.toLayer(
  ContactRpcHandlersEffect
).pipe(Layer.provide(ContactRepository.layer));
