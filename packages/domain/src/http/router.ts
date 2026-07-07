import * as Layer from "effect/Layer";

import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { AuthApiLive } from "../auth/api-live";
import { MediaApiLive } from "../media/api-live";
import { OrganizationApiLive } from "../organization/api-live";
import { ProfileApiLive } from "../profile/api-live";
// import { WidgetApiLive } from "../widget/api-live";
import { Api } from "./api";

export const HttpRoute = HttpApiBuilder.layer(Api, {
  openapiPath: "/docs/openapi.json",
}).pipe(
  Layer.provide(AuthApiLive),
  Layer.provide(MediaApiLive),
  Layer.provide(OrganizationApiLive),
  Layer.provide(ProfileApiLive)
  // Layer.provide(WidgetApiLive)
);
