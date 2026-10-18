import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { AuthMiddleware } from "../session-middleware";
import { WorkspaceServiceErrors } from "./errors";
import {
  CreateWorkspaceInput,
  CreateWorkspaceOutput,
  WorkspaceCreationState,
  WorkspaceInput,
  WorkspacePlan,
  WorkspacePlanLock,
  WorkspacePlanLockSelectionInput,
  WorkspaceProduct,
  WorkspaceSlugCheckInput,
  WorkspaceSlugCheckOutput,
} from "./schema";

export class WorkspaceRpcs extends RpcGroup.make(
  Rpc.make("CreateWorkspace", {
    payload: CreateWorkspaceInput,
    success: CreateWorkspaceOutput,
    error: WorkspaceServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("GetWorkspaceCreationState", {
    success: WorkspaceCreationState,
    error: WorkspaceServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ListWorkspaceProducts", {
    success: Schema.Array(WorkspaceProduct),
    error: WorkspaceServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("GetWorkspacePlan", {
    payload: WorkspaceInput,
    success: WorkspacePlan,
    error: WorkspaceServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("GetWorkspacePlanLock", {
    payload: WorkspaceInput,
    success: WorkspacePlanLock,
    error: WorkspaceServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("SetWorkspacePlanLockSelection", {
    payload: WorkspacePlanLockSelectionInput,
    success: WorkspacePlanLock,
    error: WorkspaceServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("CheckWorkspaceSlug", {
    payload: WorkspaceSlugCheckInput,
    success: WorkspaceSlugCheckOutput,
    error: WorkspaceServiceErrors,
  }).middleware(AuthMiddleware)
) {}
