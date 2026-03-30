import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
import { AuthMiddleware } from "../session-middleware";
import { TagServiceErrors } from "./errors";
import {
  BoardTagSet,
  ChangelogTagSet,
  Tag,
  TagCreate,
  TagDelete,
  TagList,
  TagUpdate,
} from "./schema";

export class TagRpcs extends RpcGroup.make(
  Rpc.make("TagList", {
    payload: TagList,
    success: Schema.Array(Tag),
    error: TagServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("TagCreate", {
    payload: TagCreate,
    success: Schema.Void,
    error: TagServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("TagUpdate", {
    payload: TagUpdate,
    success: Schema.Void,
    error: TagServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("TagDelete", {
    payload: TagDelete,
    success: Schema.Void,
    error: TagServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("BoardTagSet", {
    payload: BoardTagSet,
    success: Schema.Void,
    error: TagServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ChangelogTagSet", {
    payload: ChangelogTagSet,
    success: Schema.Void,
    error: TagServiceErrors,
  }).middleware(AuthMiddleware)
) {}
