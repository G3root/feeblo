import { SiteId, WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

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
  id: SiteId.schema,
  organizationId: WorkspaceId.schema,
  changelogVisibility: changelogVisibilitySchema,
  roadmapVisibility: roadmapVisibilitySchema,
  name: S.String,
});

export type TSiteUpdate = S.Schema.Type<typeof SiteUpdate>;

export const SiteHidePoweredByBranding = S.Struct({
  id: SiteId.schema,
  organizationId: WorkspaceId.schema,
  hidePoweredBy: S.Boolean,
});

export type TSiteHidePoweredByBranding = S.Schema.Type<
  typeof SiteHidePoweredByBranding
>;

export const SiteListBySubdomain = S.Struct({
  subdomain: S.String,
});

export type TSiteListBySubdomain = S.Schema.Type<typeof SiteListBySubdomain>;
