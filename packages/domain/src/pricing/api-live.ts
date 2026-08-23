import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { Api } from "../http/api";
import * as RateLimit from "../rate-limit";
import { WorkspaceRepository } from "../workspace/repository";
import { PricingHandlersEffect } from "./handlers";

/** Serves the public pricing catalog under /api/plans. */
export const PricingApiLive = HttpApiBuilder.group(
  Api,
  "PricingApiGroup",
  (handlers) =>
    handlers.handle("listPlans", () =>
      PricingHandlersEffect.pipe(
        Effect.flatMap((pricing) => pricing.listPlans()),
        RateLimit.withPublicHttpRateLimit({
          name: "ListPlans",
          level: "read",
        })
      )
    )
).pipe(Layer.provide(WorkspaceRepository.layer));
