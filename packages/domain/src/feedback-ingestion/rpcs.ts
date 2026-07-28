import * as S from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import { AuthMiddleware } from "../session-middleware";
import { FeedbackIngestionServiceErrors } from "./errors";
import {
  CaptureFeedback,
  CaptureFeedbackResult,
  FeedbackTriageCreatePost,
  FeedbackTriageIgnore,
  FeedbackTriageItem,
  FeedbackTriageLinkPost,
  FeedbackTriageList,
  FeedbackTriageResolution,
} from "./schema";

export class FeedbackIngestionRpcs extends RpcGroup.make(
  Rpc.make("FeedbackCapture", {
    payload: CaptureFeedback,
    success: CaptureFeedbackResult,
    error: FeedbackIngestionServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("FeedbackTriageList", {
    payload: FeedbackTriageList,
    success: S.Array(FeedbackTriageItem),
    error: FeedbackIngestionServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("FeedbackTriageCreatePost", {
    payload: FeedbackTriageCreatePost,
    success: FeedbackTriageResolution,
    error: FeedbackIngestionServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("FeedbackTriageLinkPost", {
    payload: FeedbackTriageLinkPost,
    success: FeedbackTriageResolution,
    error: FeedbackIngestionServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("FeedbackTriageIgnore", {
    payload: FeedbackTriageIgnore,
    success: FeedbackTriageResolution,
    error: FeedbackIngestionServiceErrors,
  }).middleware(AuthMiddleware)
) {}
