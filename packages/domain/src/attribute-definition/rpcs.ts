import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

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
  Rpc.make("ContactAttributeDefinitionList", {
    success: Schema.Array(ContactAttributeDefinition),
    payload: ContactAttributeDefinitionList,
    error: AttributeDefinitionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ContactAttributeDefinitionCreate", {
    success: Schema.Void,
    payload: ContactAttributeDefinitionCreate,
    error: AttributeDefinitionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ContactAttributeDefinitionUpdate", {
    success: Schema.Void,
    payload: ContactAttributeDefinitionUpdate,
    error: AttributeDefinitionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ContactAttributeDefinitionDelete", {
    success: Schema.Void,
    payload: ContactAttributeDefinitionDelete,
    error: AttributeDefinitionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("CompanyAttributeDefinitionList", {
    success: Schema.Array(CompanyAttributeDefinition),
    payload: CompanyAttributeDefinitionList,
    error: AttributeDefinitionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("CompanyAttributeDefinitionCreate", {
    success: Schema.Void,
    payload: CompanyAttributeDefinitionCreate,
    error: AttributeDefinitionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("CompanyAttributeDefinitionUpdate", {
    success: Schema.Void,
    payload: CompanyAttributeDefinitionUpdate,
    error: AttributeDefinitionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("CompanyAttributeDefinitionDelete", {
    success: Schema.Void,
    payload: CompanyAttributeDefinitionDelete,
    error: AttributeDefinitionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ContactAttributeValueList", {
    success: Schema.Array(ContactAttributeValue),
    payload: ContactAttributeValueList,
    error: AttributeDefinitionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ContactAttributeValueUpdate", {
    success: Schema.Void,
    payload: ContactAttributeValueUpdate,
    error: AttributeDefinitionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("CompanyAttributeValueList", {
    success: Schema.Array(CompanyAttributeValue),
    payload: CompanyAttributeValueList,
    error: AttributeDefinitionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("CompanyAttributeValueUpdate", {
    success: Schema.Void,
    payload: CompanyAttributeValueUpdate,
    error: AttributeDefinitionServiceErrors,
  }).middleware(AuthMiddleware)
) {}
