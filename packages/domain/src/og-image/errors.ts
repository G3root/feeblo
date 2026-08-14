import * as Schema from "effect/Schema";

export class OgImageRequestValidationError extends Schema.TaggedError<OgImageRequestValidationError>()(
  "OgImageRequestValidationError",
  { message: Schema.String },
  { httpApiStatus: 400, identifier: "OgImageRequestValidationError" }
) {}

export class OgImageSiteNotFoundError extends Schema.TaggedError<OgImageSiteNotFoundError>()(
  "OgImageSiteNotFoundError",
  { siteId: Schema.String },
  { httpApiStatus: 404, identifier: "OgImageSiteNotFoundError" }
) {}

export class OgImagePostNotFoundError extends Schema.TaggedError<OgImagePostNotFoundError>()(
  "OgImagePostNotFoundError",
  {
    postSlug: Schema.String,
    siteId: Schema.String,
  },
  { httpApiStatus: 404, identifier: "OgImagePostNotFoundError" }
) {}

export class OgImageRenderError extends Schema.TaggedError<OgImageRenderError>()(
  "OgImageRenderError",
  { cause: Schema.Any },
  { httpApiStatus: 500, identifier: "OgImageRenderError" }
) {}
