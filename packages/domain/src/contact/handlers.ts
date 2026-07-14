import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { withRemapDbErrors } from "../rpc-errors";
import { ContactRepository } from "./repository";
import { ContactRpcs } from "./rpcs";
import type {
  TCompanyAttributeDefinitionList,
  TCompanyAttributeValueList,
  TCompanyList,
  TContactAttributeDefinitionList,
  TContactAttributeValueList,
  TContactList,
} from "./schema";

export const ContactRpcHandlers = ContactRpcs.toLayer(
  Effect.gen(function* () {
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

      ContactAttributeDefinitionList: (args: TContactAttributeDefinitionList) =>
        repository
          .findContactAttributeDefinitions(args.organizationId)
          .pipe(
            Policy.withPolicy(Policy.hasMembership(args.organizationId)),
            withRemapDbErrors("ContactAttributeDefinition", "select")
          ),

      CompanyAttributeDefinitionList: (args: TCompanyAttributeDefinitionList) =>
        repository
          .findCompanyAttributeDefinitions(args.organizationId)
          .pipe(
            Policy.withPolicy(Policy.hasMembership(args.organizationId)),
            withRemapDbErrors("CompanyAttributeDefinition", "select")
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
  })
).pipe(Layer.provide(ContactRepository.layer));
