import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
import { AuthMiddleware, OptionalAuthMiddleware } from "../session-middleware";
import { TagServiceErrors } from "./errors";
import {
  ChangelogTagAssignment,
  ChangelogTagList,
  ChangelogTagSet,
  PostTagAssignment,
  PostTagList,
  PostTagSet,
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

  Rpc.make("TagListPublic", {
    payload: TagList,
    success: Schema.Array(Tag),
    error: TagServiceErrors,
  }).middleware(OptionalAuthMiddleware),

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

  Rpc.make("PostTagList", {
    payload: PostTagList,
    success: Schema.Array(PostTagAssignment),
    error: TagServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("PostTagListPublic", {
    payload: PostTagList,
    success: Schema.Array(PostTagAssignment),
    error: TagServiceErrors,
  }).middleware(OptionalAuthMiddleware),

  Rpc.make("ChangelogTagList", {
    payload: ChangelogTagList,
    success: Schema.Array(ChangelogTagAssignment),
    error: TagServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ChangelogTagListPublic", {
    payload: ChangelogTagList,
    success: Schema.Array(ChangelogTagAssignment),
    error: TagServiceErrors,
  }).middleware(OptionalAuthMiddleware),

  Rpc.make("PostTagSet", {
    payload: PostTagSet,
    success: Schema.Void,
    error: TagServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ChangelogTagSet", {
    payload: ChangelogTagSet,
    success: Schema.Void,
    error: TagServiceErrors,
  }).middleware(AuthMiddleware)
) {}
