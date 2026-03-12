import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
import { AuthMiddleware } from "../session-middleware";
import { WorkspaceServiceErrors } from "./errors";
import {
  CreateWorkspaceInput,
  CreateWorkspaceOutput,
  WorkspaceInput,
  WorkspaceProduct,
  WorkspaceSubscription,
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
  Rpc.make("WorkspaceSubscriptionGet", {
    payload: WorkspaceInput,
    success: Schema.Array(WorkspaceSubscription),
    error: WorkspaceServiceErrors,
  }).middleware(AuthMiddleware)
) {}
