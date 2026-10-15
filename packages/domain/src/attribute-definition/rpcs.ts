import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { AuthMiddleware } from "../session-middleware";
import { AttributeDefinitionServiceErrors } from "./errors";
import {
  CompanyAttributeDefinition,
  CompanyAttributeDefinitionCreate,
  CompanyAttributeDefinitionDelete,
  CompanyAttributeDefinitionList,
  CompanyAttributeDefinitionUpdate,
  CompanyAttributeValue,
  CompanyAttributeValueList,
  CompanyAttributeValueUpdate,
  ContactAttributeDefinition,
  ContactAttributeDefinitionCreate,
  ContactAttributeDefinitionDelete,
  ContactAttributeDefinitionList,
  ContactAttributeDefinitionUpdate,
  ContactAttributeValue,
  ContactAttributeValueList,
  ContactAttributeValueUpdate,
} from "./schema";

export class AttributeDefinitionRpcs extends RpcGroup.make(
  Rpc.make("ListContactAttributeDefinitions", {
    success: Schema.Array(ContactAttributeDefinition),
    payload: ContactAttributeDefinitionList,
    error: AttributeDefinitionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("CreateContactAttributeDefinition", {
    success: Schema.Void,
    payload: ContactAttributeDefinitionCreate,
    error: AttributeDefinitionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("UpdateContactAttributeDefinition", {
    success: Schema.Void,
    payload: ContactAttributeDefinitionUpdate,
    error: AttributeDefinitionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("DeleteContactAttributeDefinition", {
    success: Schema.Void,
    payload: ContactAttributeDefinitionDelete,
    error: AttributeDefinitionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ListCompanyAttributeDefinitions", {
    success: Schema.Array(CompanyAttributeDefinition),
    payload: CompanyAttributeDefinitionList,
    error: AttributeDefinitionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("CreateCompanyAttributeDefinition", {
    success: Schema.Void,
    payload: CompanyAttributeDefinitionCreate,
    error: AttributeDefinitionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("UpdateCompanyAttributeDefinition", {
    success: Schema.Void,
    payload: CompanyAttributeDefinitionUpdate,
    error: AttributeDefinitionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("DeleteCompanyAttributeDefinition", {
    success: Schema.Void,
    payload: CompanyAttributeDefinitionDelete,
    error: AttributeDefinitionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ListContactAttributeValues", {
    success: Schema.Array(ContactAttributeValue),
    payload: ContactAttributeValueList,
    error: AttributeDefinitionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("UpdateContactAttributeValue", {
    success: Schema.Void,
    payload: ContactAttributeValueUpdate,
    error: AttributeDefinitionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ListCompanyAttributeValues", {
    success: Schema.Array(CompanyAttributeValue),
    payload: CompanyAttributeValueList,
    error: AttributeDefinitionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("UpdateCompanyAttributeValue", {
    success: Schema.Void,
    payload: CompanyAttributeValueUpdate,
    error: AttributeDefinitionServiceErrors,
  }).middleware(AuthMiddleware)
) {}
