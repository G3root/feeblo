import * as Schema from "effect/Schema";

import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { AuthMiddleware } from "../session-middleware";
import { ContactServiceErrors } from "./errors";
import {
  Company,
  CompanyAttributeDefinition,
  CompanyAttributeDefinitionDelete,
  CompanyAttributeDefinitionList,
  CompanyAttributeDefinitionUpsert,
  CompanyAttributeValue,
  CompanyAttributeValueList,
  CompanyAttributeValueUpsert,
  CompanyDelete,
  CompanyList,
  CompanyUpsert,
  Contact,
  ContactAttributeDefinition,
  ContactAttributeDefinitionDelete,
  ContactAttributeDefinitionList,
  ContactAttributeDefinitionUpsert,
  ContactAttributeValue,
  ContactAttributeValueList,
  ContactAttributeValueUpsert,
  ContactDelete,
  ContactList,
  ContactUpsert,
} from "./schema";

export class ContactRpcs extends RpcGroup.make(
  Rpc.make("ContactUpsert", {
    success: Contact,
    payload: ContactUpsert,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ContactList", {
    success: Schema.Array(Contact),
    payload: ContactList,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ContactDelete", {
    success: Schema.Void,
    payload: ContactDelete,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("CompanyUpsert", {
    success: Company,
    payload: CompanyUpsert,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("CompanyList", {
    success: Schema.Array(Company),
    payload: CompanyList,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("CompanyDelete", {
    success: Schema.Void,
    payload: CompanyDelete,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ContactAttributeDefinitionList", {
    success: Schema.Array(ContactAttributeDefinition),
    payload: ContactAttributeDefinitionList,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ContactAttributeDefinitionUpsert", {
    success: ContactAttributeDefinition,
    payload: ContactAttributeDefinitionUpsert,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ContactAttributeDefinitionDelete", {
    success: Schema.Void,
    payload: ContactAttributeDefinitionDelete,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("CompanyAttributeDefinitionList", {
    success: Schema.Array(CompanyAttributeDefinition),
    payload: CompanyAttributeDefinitionList,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("CompanyAttributeDefinitionUpsert", {
    success: CompanyAttributeDefinition,
    payload: CompanyAttributeDefinitionUpsert,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("CompanyAttributeDefinitionDelete", {
    success: Schema.Void,
    payload: CompanyAttributeDefinitionDelete,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ContactAttributeValueList", {
    success: Schema.Array(ContactAttributeValue),
    payload: ContactAttributeValueList,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ContactAttributeValueUpsert", {
    success: ContactAttributeValue,
    payload: ContactAttributeValueUpsert,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("CompanyAttributeValueList", {
    success: Schema.Array(CompanyAttributeValue),
    payload: CompanyAttributeValueList,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("CompanyAttributeValueUpsert", {
    success: CompanyAttributeValue,
    payload: CompanyAttributeValueUpsert,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware)
) {}
