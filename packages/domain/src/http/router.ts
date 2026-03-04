import { HttpLayerRouter } from "@effect/platform";
import { Layer } from "effect";
import { AuthApiLive } from "../auth/api-live";
import { ProfileApiLive } from "../profile/api-live";
import { S3UploadServiceLive } from "../services/s3";
import { Api } from "./api";

export const HttpRoute = HttpLayerRouter.addHttpApi(Api, {
  openapiPath: "/docs/openapi.json",
}).pipe(
  Layer.provide(AuthApiLive),
  Layer.provide(ProfileApiLive),
  Layer.provide(S3UploadServiceLive)
);
