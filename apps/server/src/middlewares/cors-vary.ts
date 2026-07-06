import * as Effect from "effect/Effect";

import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

export const corsVaryFix = HttpRouter.middleware(
  (effect) =>
    Effect.gen(function* () {
      const response = yield* effect;
      const allowOrigin = response.headers["access-control-allow-origin"];
      if (!allowOrigin || allowOrigin === "*") {
        return response;
      }

      const vary = response.headers?.vary;
      if (!vary) {
        return HttpServerResponse.setHeader(response, "vary", "Origin");
      }

      const tokens = vary.split(",").map((s) => s.trim().toLowerCase());
      if (tokens.includes("origin") || tokens.includes("*")) {
        return response;
      }

      return HttpServerResponse.setHeader(response, "vary", `${vary}, Origin`);
    }),
  { global: true }
);
