import * as Schema from "effect/Schema";

import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as OpenApi from "effect/unstable/httpapi/OpenApi";

import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
} from "../rpc-errors";
import {
  WidgetBoard,
  WidgetFeedbackCreate,
  WidgetFeedbackResponse,
} from "./schema";

export class WidgetApiGroup extends HttpApiGroup.make("WidgetApiGroup")
  .add(
    HttpApiEndpoint.post("createFeedback", "/feedback", {
      payload: WidgetFeedbackCreate,
      success: WidgetFeedbackResponse,
      error: Schema.Union([
        BadRequestError,
        NotFoundError,
        InternalServerError,
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
    HttpApiEndpoint.get("listBoards", "/boards", {
      payload: {
        organizationId: Schema.String,
      },
      success: Schema.Array(WidgetBoard),
      error: Schema.Union([BadRequestError, InternalServerError]),
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
