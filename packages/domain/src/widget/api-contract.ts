import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import * as OpenApi from "effect/http-api/OpenApi";
import * as Schema from "effect/Schema";

import { DataValidationError } from "../contact/errors";
import { PolicyDeniedError } from "../policy";
import { RateLimitErrors } from "../rate-limit";
import {
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
} from "../rpc-errors";
import {
  WidgetBoard,
  WidgetBoardList,
  WidgetFeedbackCreate,
  WidgetFeedbackResponse,
  WidgetHelpArticleRequest,
  WidgetHelpCenter,
  WidgetHelpCenterArticleRequest,
  WidgetHelpCenterArticleResponse,
  WidgetHelpArticles,
  WidgetSuggestion,
  WidgetSuggestionRequest,
  WidgetUpdate,
} from "./schema";

/**
 * The closed failure surface of `createFeedback`. The handler folds every
 * other write-path failure into `InternalServerError`, so this is the single
 * source of truth for what the endpoint publishes (and the predicate the fold
 * narrows with).
 */
export const WidgetCreateFeedbackErrors = Schema.Union([
  DataValidationError,
  NotFoundError,
  InternalServerError,
  UnauthorizedError,
  // A banned SSO identity is a real 403, not a server failure. The private
  // board policy refusal also reaches this union for the same reason.
  PolicyDeniedError,
  RateLimitErrors,
]);

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
    HttpApiEndpoint.post("helpArticles", "/help-articles", {
      payload: WidgetHelpArticleRequest,
      success: WidgetHelpArticles,
      error: Schema.Union([
        DataValidationError,
        InternalServerError,
        RateLimitErrors,
      ]),
    })
      .annotate(OpenApi.Title, "Help Articles")
      .annotate(OpenApi.Summary, "Find help center articles that may answer it")
      .annotate(
        OpenApi.Description,
        "Returns published help center articles that match the question being written, so the composer can offer existing documentation before a new post is created."
      )
  )
  .add(
    HttpApiEndpoint.post("helpCenter", "/help-center", {
      payload: WidgetBoardList,
      success: WidgetHelpCenter,
      error: Schema.Union([
        DataValidationError,
        InternalServerError,
        RateLimitErrors,
      ]),
    })
      .annotate(OpenApi.Title, "Help Center")
      .annotate(OpenApi.Summary, "List the published documentation")
      .annotate(
        OpenApi.Description,
        "Every published help center article with its section, for the widget's Help module. `enabled` is false when the surface does not exist for this workspace."
      )
  )
  .add(
    HttpApiEndpoint.post("helpCenterArticle", "/help-center/article", {
      payload: WidgetHelpCenterArticleRequest,
      success: WidgetHelpCenterArticleResponse,
      error: Schema.Union([
        DataValidationError,
        InternalServerError,
        RateLimitErrors,
      ]),
    })
      .annotate(OpenApi.Title, "Help Center Article")
      .annotate(OpenApi.Summary, "Read one published article")
      .annotate(
        OpenApi.Description,
        "One published article, rendered to HTML, addressed by its slug. A draft or an article in another workspace answers `article: null`."
      )
  )
  .add(
    HttpApiEndpoint.post("createFeedback", "/feedback", {
      payload: WidgetFeedbackCreate,
      success: WidgetFeedbackResponse,
      error: WidgetCreateFeedbackErrors,
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
