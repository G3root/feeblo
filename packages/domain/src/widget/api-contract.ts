import * as Schema from "effect/Schema";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as OpenApi from "effect/unstable/httpapi/OpenApi";

import { DataValidationError } from "../contact/errors";
import { RateLimitErrors } from "../rate-limit";
import {
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
} from "../rpc-errors";
import {
  WidgetBoard,
  WidgetFeedbackCreate,
  WidgetFeedbackResponse,
  WidgetSuggestion,
  WidgetSuggestionRequest,
  WidgetUpdate,
} from "./schema";

export class WidgetApiGroup extends HttpApiGroup.make("WidgetApiGroup")
  .add(
    HttpApiEndpoint.post("suggestPosts", "/suggestions", {
      payload: WidgetSuggestionRequest,
      success: Schema.Array(WidgetSuggestion),
      error: Schema.Union([
        DataValidationError,
        InternalServerError,
        RateLimitErrors,
      ]),
    })
      .annotate(OpenApi.Title, "Suggest Posts")
      .annotate(OpenApi.Summary, "Find similar public posts")
  )
  .add(
    HttpApiEndpoint.post("createFeedback", "/feedback", {
      payload: WidgetFeedbackCreate,
      success: WidgetFeedbackResponse,
      error: Schema.Union([
        DataValidationError,
        NotFoundError,
        InternalServerError,
        UnauthorizedError,
        RateLimitErrors,
      ]),
    })
      .annotate(OpenApi.Title, "Create Feedback")
      .annotate(OpenApi.Summary, "Create a feedback post")
      .annotate(
        OpenApi.Description,
        "Creates a new feedback post on a public board. The default open status for the organization is assigned automatically."
      )
  )
  .add(
    HttpApiEndpoint.get("listUpdates", "/updates", {
      payload: {
        organizationId: Schema.String,
      },
      success: Schema.Array(WidgetUpdate),
      error: Schema.Union([
        DataValidationError,
        InternalServerError,
        RateLimitErrors,
      ]),
    })
      .annotate(OpenApi.Title, "List Updates")
      .annotate(OpenApi.Summary, "List published product updates")
      .annotate(
        OpenApi.Description,
        "Returns published changelog entries for the requested organization, newest first."
      )
  )
  .add(
    HttpApiEndpoint.get("listBoards", "/boards", {
      payload: {
        organizationId: Schema.String,
      },
      success: Schema.Array(WidgetBoard),
      error: Schema.Union([
        DataValidationError,
        InternalServerError,
        RateLimitErrors,
      ]),
    })
      .annotate(OpenApi.Title, "List Boards")
      .annotate(OpenApi.Summary, "List all public boards")
      .annotate(
        OpenApi.Description,
        "Returns all public boards for a given organization."
      )
  ) {}

export class WidgetApi extends HttpApi.make("WidgetApi")
  .add(WidgetApiGroup)
  .prefix("/api/widget/v1") {}
