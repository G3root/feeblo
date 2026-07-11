import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as Policy from "../policy";
import { withRemapDbErrors } from "../rpc-errors";
import { ContactRepository } from "./repository";
import { ContactRpcs } from "./rpcs";
import type {
  TCompanyAttributeDefinitionDelete,
  TCompanyAttributeDefinitionList,
  TCompanyAttributeDefinitionUpsert,
  TCompanyAttributeValueList,
  TCompanyAttributeValueUpsert,
  TCompanyDelete,
  TCompanyList,
  TCompanyUpsert,
  TContactAttributeDefinitionDelete,
  TContactAttributeDefinitionList,
  TContactAttributeDefinitionUpsert,
  TContactAttributeValueList,
  TContactAttributeValueUpsert,
  TContactDelete,
  TContactList,
  TContactUpsert,
} from "./schema";
import {
  Company,
  CompanyAttributeDefinition,
  CompanyAttributeValue,
  Contact,
  ContactAttributeDefinition,
  ContactAttributeValue,
} from "./schema";

const decodeDbRows =
  <A>(schema: Schema.Schema<A>) =>
  (rows: readonly unknown[]) =>
    Schema.decodeUnknownEffect(Schema.Array(schema))(rows);

const decodeDbRow =
  <A>(schema: Schema.Schema<A>) =>
  (row: unknown) =>
    Schema.decodeUnknownEffect(schema)(row);

export const ContactRpcHandlers = ContactRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* ContactRepository;

    return {
      ContactUpsert: (args: TContactUpsert) =>
        repository.upsertContact(args).pipe(
          Effect.flatMap((result) =>
            result._tag === "Some"
              ? decodeDbRow(Contact)(result.value)
              : Effect.die(new Error("Contact upsert did not return a row"))
          ),
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Contact", "create")
        ),

      ContactList: (args: TContactList) =>
        repository
          .findManyContacts(args.organizationId)
          .pipe(
            Policy.withPolicy(Policy.hasMembership(args.organizationId)),
            withRemapDbErrors("Contact", "select")
          ),

      ContactDelete: (args: TContactDelete) =>
        repository
          .deleteContact(args)
          .pipe(
            Effect.asVoid,
            Policy.withPolicy(Policy.hasMembership(args.organizationId)),
            withRemapDbErrors("Contact", "delete")
          ),

      CompanyUpsert: (args: TCompanyUpsert) =>
        repository
          .upsertCompany(args)
          .pipe(
            Effect.flatMap(decodeDbRow(Company)),
            Policy.withPolicy(Policy.hasMembership(args.organizationId)),
            withRemapDbErrors("Company", "create")
          ),

      CompanyList: (args: TCompanyList) =>
        repository
          .findManyCompanies(args.organizationId)
          .pipe(
            Policy.withPolicy(Policy.hasMembership(args.organizationId)),
            withRemapDbErrors("Company", "select")
          ),

      CompanyDelete: (args: TCompanyDelete) =>
        repository
          .deleteCompany(args)
          .pipe(
            Effect.asVoid,
            Policy.withPolicy(Policy.hasMembership(args.organizationId)),
            withRemapDbErrors("Company", "delete")
          ),

      ContactAttributeDefinitionList: (args: TContactAttributeDefinitionList) =>
        repository
          .findContactAttributeDefinitions(args.organizationId)
          .pipe(
            Policy.withPolicy(Policy.hasMembership(args.organizationId)),
            withRemapDbErrors("ContactAttributeDefinition", "select")
          ),

      ContactAttributeDefinitionUpsert: (
        args: TContactAttributeDefinitionUpsert
      ) =>
        repository
          .upsertContactAttributeDefinition(args)
          .pipe(
            Effect.flatMap(decodeDbRow(ContactAttributeDefinition)),
            Policy.withPolicy(Policy.hasMembership(args.organizationId)),
            withRemapDbErrors("ContactAttributeDefinition", "create")
          ),

      ContactAttributeDefinitionDelete: (
        args: TContactAttributeDefinitionDelete
      ) =>
        repository
          .deleteContactAttributeDefinition(args.id)
          .pipe(
            Effect.asVoid,
            withRemapDbErrors("ContactAttributeDefinition", "delete")
          ),

      CompanyAttributeDefinitionList: (args: TCompanyAttributeDefinitionList) =>
        repository
          .findCompanyAttributeDefinitions(args.organizationId)
          .pipe(
            Policy.withPolicy(Policy.hasMembership(args.organizationId)),
            withRemapDbErrors("CompanyAttributeDefinition", "select")
          ),

      CompanyAttributeDefinitionUpsert: (
        args: TCompanyAttributeDefinitionUpsert
      ) =>
        repository
          .upsertCompanyAttributeDefinition(args)
          .pipe(
            Effect.flatMap(decodeDbRow(CompanyAttributeDefinition)),
            Policy.withPolicy(Policy.hasMembership(args.organizationId)),
            withRemapDbErrors("CompanyAttributeDefinition", "create")
          ),

      CompanyAttributeDefinitionDelete: (
        args: TCompanyAttributeDefinitionDelete
      ) =>
        repository
          .deleteCompanyAttributeDefinition(args.id)
          .pipe(
            Effect.asVoid,
            withRemapDbErrors("CompanyAttributeDefinition", "delete")
          ),

      ContactAttributeValueList: (args: TContactAttributeValueList) =>
        repository
          .findContactAttributeValues(args.contactId)
          .pipe(
            Effect.flatMap(decodeDbRows(ContactAttributeValue)),
            withRemapDbErrors("ContactAttributeValue", "select")
          ),

      ContactAttributeValueUpsert: (args: TContactAttributeValueUpsert) =>
        repository
          .upsertContactAttributeValue(args)
          .pipe(
            Effect.flatMap(decodeDbRow(ContactAttributeValue)),
            withRemapDbErrors("ContactAttributeValue", "create")
          ),

      CompanyAttributeValueList: (args: TCompanyAttributeValueList) =>
        repository
          .findCompanyAttributeValues(args.companyId)
          .pipe(
            Effect.flatMap(decodeDbRows(CompanyAttributeValue)),
            withRemapDbErrors("CompanyAttributeValue", "select")
          ),

      CompanyAttributeValueUpsert: (args: TCompanyAttributeValueUpsert) =>
        repository
          .upsertCompanyAttributeValue(args)
          .pipe(
            Effect.flatMap(decodeDbRow(CompanyAttributeValue)),
            withRemapDbErrors("CompanyAttributeValue", "create")
          ),
    };
  })
).pipe(Layer.provide(ContactRepository.layer));
