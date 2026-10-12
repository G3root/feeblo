import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { RateLimitErrors } from "../rate-limit";
import { AuthMiddleware } from "../session-middleware";
import { ContactServiceErrors } from "./errors";
import {
  Contact,
  ContactCreate,
  ContactCreateEligibility,
  ContactDelete,
  ContactList,
  ContactSearch,
  ContactSearchResult,
  ContactUnsubscribe,
  ContactUpdate,
} from "./schema";

export class ContactRpcs extends RpcGroup.make(
  Rpc.make("ContactList", {
    success: Schema.Array(Contact),
    payload: ContactList,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ContactSearch", {
    success: Schema.Array(ContactSearchResult),
    payload: ContactSearch,
    // The picker consumes the per-member dashboard read rate limit.
    error: Schema.Union([ContactServiceErrors, RateLimitErrors]),
  }).middleware(AuthMiddleware),

  Rpc.make("ContactCreate", {
    success: Contact,
    payload: ContactCreate,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ContactUpdate", {
    success: Contact,
    payload: ContactUpdate,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ContactDelete", {
    success: Schema.Void,
    payload: ContactDelete,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ContactCreateEligibility", {
    success: Schema.Struct({ canCreate: Schema.Boolean }),
    payload: ContactCreateEligibility,
    error: Schema.Union([ContactServiceErrors, RateLimitErrors]),
  }).middleware(AuthMiddleware),

  Rpc.make("ContactUnsubscribe", {
    success: Schema.Void,
    payload: ContactUnsubscribe,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware)
) {}
