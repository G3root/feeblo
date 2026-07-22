import * as Schema from "effect/Schema";

export class OgImageRequestValidationError extends Schema.TaggedErrorClass<OgImageRequestValidationError>()(
  "OgImageRequestValidationError",
  { message: Schema.String },
  { httpApiStatus: 400, identifier: "OgImageRequestValidationError" }
) {}

export class OgImageSiteNotFoundError extends Schema.TaggedErrorClass<OgImageSiteNotFoundError>()(
  "OgImageSiteNotFoundError",
  { siteId: Schema.String },
  { httpApiStatus: 404, identifier: "OgImageSiteNotFoundError" }
) {}

export class OgImagePostNotFoundError extends Schema.TaggedErrorClass<OgImagePostNotFoundError>()(
  "OgImagePostNotFoundError",
  {
    postSlug: Schema.String,
    siteId: Schema.String,
  },
  { httpApiStatus: 404, identifier: "OgImagePostNotFoundError" }
) {}

export class OgImageRenderError extends Schema.TaggedErrorClass<OgImageRenderError>()(
  "OgImageRenderError",
  { cause: Schema.Any },
  { httpApiStatus: 500, identifier: "OgImageRenderError" }
) {}
