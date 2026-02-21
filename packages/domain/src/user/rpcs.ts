import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
import { User } from "./schema";

export class UserRpcs extends RpcGroup.make(
  Rpc.make("UserList", {
    success: User,
    stream: true,
  }),
  Rpc.make("UserById", {
    success: User,
    error: Schema.String,
    payload: {
      id: Schema.String,
    },
  }),
  Rpc.make("UserCreate", {
    success: User,
    payload: {
      name: Schema.String,
    },
  })
) {}
