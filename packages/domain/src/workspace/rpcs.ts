import * as Schema from "effect/Schema";

import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { AuthMiddleware } from "../session-middleware";
import { WorkspaceServiceErrors } from "./errors";
import {
  CreateWorkspaceInput,
  CreateWorkspaceOutput,
  WorkspaceInput,
  WorkspacePlan,
  WorkspaceProduct,
  WorkspaceSlugCheckInput,
  WorkspaceSlugCheckOutput,
} from "./schema";

export class WorkspaceRpcs extends RpcGroup.make(
  Rpc.make("WorkspaceCreate", {
    payload: CreateWorkspaceInput,
    success: CreateWorkspaceOutput,
    error: WorkspaceServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("WorkspaceProductList", {
    success: Schema.Array(WorkspaceProduct),
    error: WorkspaceServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("WorkspacePlanGet", {
    payload: WorkspaceInput,
    success: WorkspacePlan,
    error: WorkspaceServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("WorkspaceSlugCheck", {
    payload: WorkspaceSlugCheckInput,
    success: WorkspaceSlugCheckOutput,
    error: WorkspaceServiceErrors,
  }).middleware(AuthMiddleware)
) {}
