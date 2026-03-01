import { HttpLayerRouter } from "@effect/platform";
import { Layer } from "effect";
import { AuthApiLive } from "../auth/api-live";
import { Api } from "./api";

export const HttpRoute = HttpLayerRouter.addHttpApi(Api, {
  openapiPath: "/docs/openapi.json",
}).pipe(Layer.provide(AuthApiLive));
