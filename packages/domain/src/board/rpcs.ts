import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
import { AuthMiddleware } from "../session-middleware";
import { Board } from "./schema";

export class BoardRpcs extends RpcGroup.make(
  Rpc.make("BoardList", {
    success: Schema.Array(Board),
  }),

  Rpc.make("BoardDelete", {
    success: Schema.Void,
    payload: {
      id: Schema.String,
    },
  })
).middleware(AuthMiddleware) {}
