import { Schema as S } from "effect";

export const changelogVisibilitySchema = S.Literals(["PUBLIC", "HIDDEN"]);
export const roadmapVisibilitySchema = S.Literals(["PUBLIC", "HIDDEN"]);

export const Site = S.Struct({
  id: S.String,
  name: S.String,
  subdomain: S.String,
  customDomain: S.Union([S.String, S.Null]),
  changelogVisibility: changelogVisibilitySchema,
  roadmapVisibility: roadmapVisibilitySchema,
  hidePoweredBy: S.Boolean,
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
  organizationId: S.String,
});

export type TSite = S.Schema.Type<typeof Site>;

export const SiteList = S.Struct({
  organizationId: S.String,
});

export type TSiteList = S.Schema.Type<typeof SiteList>;

export const SiteUpdate = S.Struct({
  id: S.String,
  organizationId: S.String,
  changelogVisibility: changelogVisibilitySchema,
  roadmapVisibility: roadmapVisibilitySchema,
  name: S.String,
});

export type TSiteUpdate = S.Schema.Type<typeof SiteUpdate>;

export const SiteHidePoweredByBranding = S.Struct({
  id: S.String,
  organizationId: S.String,
  hidePoweredBy: S.Boolean,
});

export type TSiteHidePoweredByBranding = S.Schema.Type<
  typeof SiteHidePoweredByBranding
>;

export const SiteListBySubdomain = S.Struct({
  subdomain: S.String,
});

export type TSiteListBySubdomain = S.Schema.Type<typeof SiteListBySubdomain>;
