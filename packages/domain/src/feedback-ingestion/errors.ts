import * as S from "effect/Schema";
import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";

export class FeedbackChannelDisabledError extends S.TaggedErrorClass<FeedbackChannelDisabledError>()(
  "FeedbackChannelDisabledError",
  { channelKey: S.String },
  { httpApiStatus: 409, identifier: "FeedbackChannelDisabledError" }
) {}

export class FeedbackNotFoundError extends S.TaggedErrorClass<FeedbackNotFoundError>()(
  "FeedbackNotFoundError",
  { message: S.optional(S.String) },
  { httpApiStatus: 404, identifier: "FeedbackNotFoundError" }
) {}

export class FeedbackTriageAlreadyDecidedError extends S.TaggedErrorClass<FeedbackTriageAlreadyDecidedError>()(
  "FeedbackTriageAlreadyDecidedError",
  { triageItemId: S.String },
  { httpApiStatus: 409, identifier: "FeedbackTriageAlreadyDecidedError" }
) {}

export class FeedbackProcessingDataError extends S.TaggedErrorClass<FeedbackProcessingDataError>()(
  "FeedbackProcessingDataError",
  {
    operation: S.String,
    cause: S.Defect,
  }
) {}

export const FeedbackIngestionServiceErrors = S.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  BadRequestError,
  FeedbackChannelDisabledError,
  FeedbackNotFoundError,
  FeedbackTriageAlreadyDecidedError,
]);

export const FeedbackProcessingErrors = S.Union([
  FeedbackNotFoundError,
  FeedbackProcessingDataError,
]);
