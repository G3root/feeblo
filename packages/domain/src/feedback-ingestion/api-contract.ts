import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as OpenApi from "effect/unstable/httpapi/OpenApi";
import { FeedbackIngestionServiceErrors } from "./errors";
import { ExternalFeedbackCapture, CaptureFeedbackResult } from "./schema";
import { ExternalIngestionAuthMiddleware } from "./external-auth";

export const FeedbackIngestionApiGroup = HttpApiGroup.make(
  "FeedbackIngestionApiGroup"
)
  .add(
    HttpApiEndpoint.post("captureExternalFeedback", "/ingestion/v1/feedback", {
      payload: ExternalFeedbackCapture,
      success: CaptureFeedbackResult,
      error: FeedbackIngestionServiceErrors,
    })
      .annotate(OpenApi.Title, "Capture external feedback")
      .annotate(
        OpenApi.Description,
        "Captures feedback using a workspace-scoped bearer credential."
      )
  )
  .middleware(ExternalIngestionAuthMiddleware);
