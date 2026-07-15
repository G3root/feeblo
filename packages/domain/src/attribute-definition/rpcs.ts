import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { AuthMiddleware } from "../session-middleware";
import { AttributeDefinitionServiceErrors } from "./errors";
import {
  CompanyAttributeDefinition,
  CompanyAttributeDefinitionCreate,
  CompanyAttributeDefinitionList,
  CompanyAttributeValue,
  CompanyAttributeValueList,
  ContactAttributeDefinition,
  ContactAttributeDefinitionCreate,
  ContactAttributeDefinitionList,
  ContactAttributeValue,
  ContactAttributeValueList,
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
  Rpc.make("ContactAttributeValueList", {
    success: Schema.Array(ContactAttributeValue),
    payload: ContactAttributeValueList,
    error: AttributeDefinitionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("CompanyAttributeValueList", {
    success: Schema.Array(CompanyAttributeValue),
    payload: CompanyAttributeValueList,
    error: AttributeDefinitionServiceErrors,
  }).middleware(AuthMiddleware)
) {}
