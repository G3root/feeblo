import * as Schema from "effect/Schema";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";
import * as OpenApi from "effect/unstable/httpapi/OpenApi";

import { RateLimitErrors } from "../rate-limit";
import { InternalServerError } from "../rpc-errors";
import { PlansResponse } from "./schema";

/** Public plan catalog for marketing surfaces such as pricing tables. */
export class PricingApiGroup extends HttpApiGroup.make("PricingApiGroup").add(
  HttpApiEndpoint.get("listPlans", "/plans", {
    success: HttpApiSchema.WithHeaders(PlansResponse, {
      "cache-control": Schema.String,
    }),
    error: Schema.Union([InternalServerError, RateLimitErrors]),
  })
    .annotate(OpenApi.Title, "List Plans")
    .annotate(OpenApi.Summary, "Get plan capabilities, limits, and prices")
    .annotate(
      OpenApi.Description,
      "Returns every plan's limits, capabilities, display-ready feature rows, and current prices. Public; intended for rendering pricing tables."
    )
) {}
