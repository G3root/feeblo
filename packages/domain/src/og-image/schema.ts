import { SiteId } from "@feeblo/id";
import * as Schema from "effect/Schema";

import { PostStatusType } from "../post-status/schema";

const ValidSiteId = SiteId.schema.check(
  Schema.makeFilter(SiteId.is, { message: "Must be a valid site ID" })
);

const MainImageRequest = Schema.Struct({
  siteId: ValidSiteId,
  type: Schema.Literals(["feedback-main", "changelog-main", "roadmap-main"]),
});

const PostDetailImageRequest = Schema.Struct({
  post: Schema.Trim.pipe(Schema.check(Schema.isMinLength(1))),
  siteId: ValidSiteId,
  type: Schema.Literal("post-detail"),
});

export const OgImageRequest = Schema.Union([
  MainImageRequest,
  PostDetailImageRequest,
]);

export type OgImageRequest = typeof OgImageRequest.Type;

const MainImageData = Schema.Struct({
  siteName: Schema.String,
  type: Schema.Literals(["feedback-main", "changelog-main", "roadmap-main"]),
});

const PostDetailImageData = Schema.Struct({
  boardName: Schema.String,
  siteName: Schema.String,
  status: PostStatusType,
  title: Schema.String,
  type: Schema.Literal("post-detail"),
  upvoteCount: Schema.Number,
});

export const OgImageData = Schema.Union([MainImageData, PostDetailImageData]);

export type OgImageData = typeof OgImageData.Type;
