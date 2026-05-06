import { Schema } from "effect";

export const changelogVisibilitySchema = Schema.Literals(["PUBLIC", "HIDDEN"]);
export const roadmapVisibilitySchema = Schema.Literals(["PUBLIC", "HIDDEN"]);

export class Site extends Schema.Class<Site>("Site")({
  id: Schema.String,
  name: Schema.String,
  subdomain: Schema.String,
  customDomain: Schema.Union([Schema.String, Schema.Null]),
  changelogVisibility: changelogVisibilitySchema,
  roadmapVisibility: roadmapVisibilitySchema,
  hidePoweredBy: Schema.Boolean,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
  organizationId: Schema.String,
}) {}

export const SiteList = Schema.Struct({
  organizationId: Schema.String,
});

export type TSiteList = Schema.Schema.Type<typeof SiteList>;

export const SiteUpdate = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  changelogVisibility: changelogVisibilitySchema,
  roadmapVisibility: roadmapVisibilitySchema,
  name: Schema.String,
});

export type TSiteUpdate = Schema.Schema.Type<typeof SiteUpdate>;

export const SiteHidePoweredByBranding = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  hidePoweredBy: Schema.Boolean,
});

export type TSiteHidePoweredByBranding = Schema.Schema.Type<
  typeof SiteHidePoweredByBranding
>;

export const SiteListBySubdomain = Schema.Struct({
  subdomain: Schema.String,
});

export type TSiteListBySubdomain = Schema.Schema.Type<
  typeof SiteListBySubdomain
>;
