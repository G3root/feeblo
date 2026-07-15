import * as Schema from "effect/Schema";

import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { AuthMiddleware } from "../session-middleware";
import { ContactServiceErrors } from "./errors";
import { Contact, ContactList, ContactUpsert } from "./schema";

export class ContactRpcs extends RpcGroup.make(
  Rpc.make("ContactList", {
    success: Schema.Array(Contact),
    payload: ContactList,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ContactUpsert", {
    success: Schema.NullOr(Contact),
    payload: ContactUpsert,
    error: ContactServiceErrors,
  }).middleware(AuthMiddleware)
) {}
