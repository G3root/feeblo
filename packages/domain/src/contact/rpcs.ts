import * as Schema from "effect/Schema";

import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { AuthMiddleware } from "../session-middleware";
import { ContactServiceErrors } from "./errors";
import {
  Company,
  CompanyAttributeDefinition,
  CompanyAttributeDefinitionCreate,
  CompanyAttributeDefinitionList,
  CompanyAttributeValue,
  CompanyAttributeValueList,
  CompanyList,
  CompanyUpsert,
  Contact,
  ContactAttributeDefinition,
  ContactAttributeDefinitionCreate,
  ContactAttributeDefinitionList,
  ContactAttributeValue,
  ContactAttributeValueList,
  ContactList,
  ContactUpsert,
} from "./schema";

export class ContactRpcs extends RpcGroup.make(
  Rpc.make("ContactList", {
    success: Schema.Array(Contact),
    payload: ContactList,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("CompanyList", {
    success: Schema.Array(Company),
    payload: CompanyList,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ContactUpsert", {
    success: Schema.NullOr(Contact),
    payload: ContactUpsert,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("CompanyUpsert", {
    success: Company,
    payload: CompanyUpsert,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ContactAttributeDefinitionList", {
    success: Schema.Array(ContactAttributeDefinition),
    payload: ContactAttributeDefinitionList,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ContactAttributeDefinitionCreate", {
    success: Schema.Void,
    payload: ContactAttributeDefinitionCreate,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("CompanyAttributeDefinitionList", {
    success: Schema.Array(CompanyAttributeDefinition),
    payload: CompanyAttributeDefinitionList,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("CompanyAttributeDefinitionCreate", {
    success: Schema.Void,
    payload: CompanyAttributeDefinitionCreate,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ContactAttributeValueList", {
    success: Schema.Array(ContactAttributeValue),
    payload: ContactAttributeValueList,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("CompanyAttributeValueList", {
    success: Schema.Array(CompanyAttributeValue),
    payload: CompanyAttributeValueList,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware)
) {}
