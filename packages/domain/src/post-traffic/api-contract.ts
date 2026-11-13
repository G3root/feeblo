import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import * as OpenApi from "effect/http-api/OpenApi";

import { RecordPostViewAccepted, RecordPostViewInput } from "./schema";

/**
 * The page-view ingest.
 *
 * It is unauthenticated and called by the board's same-origin relay, not by the
 * browser directly: the relay is what keeps a board on a customer's custom
 * domain out of the API's origin check (the same arrangement as browser
 * telemetry). The endpoint answers `accepted` for every request it reads,
 * including one it discards, so it never tells a caller whether a post exists
 * or is public.
 */
export class PostTrafficApiGroup extends HttpApiGroup.make(
  "PostTrafficApiGroup"
).add(
  HttpApiEndpoint.post("recordPostView", "/views", {
    payload: RecordPostViewInput,
    success: RecordPostViewAccepted,
  })
    .annotate(OpenApi.Title, "Record Post View")
    .annotate(OpenApi.Summary, "Record one page view of a public post")
    .annotate(
      OpenApi.Description,
      "Records a page view for a public post. Bots and views of posts a visitor cannot open are accepted and discarded."
    )
) {}

export class PostTrafficApi extends HttpApi.make("PostTrafficApi")
  .add(PostTrafficApiGroup)
  .prefix("/api/traffic/v1") {}
