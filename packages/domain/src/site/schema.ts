import { Schema } from "effect";

export const changelogVisibilitySchema = Schema.Literal("PUBLIC", "HIDDEN");

export class Site extends Schema.Class<Site>("Site")({
  id: Schema.String,
  name: Schema.String,
  subdomain: Schema.String,
  customDomain: Schema.Union(Schema.String, Schema.Null),
  changelogVisibility: changelogVisibilitySchema,
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
});

export type TSiteUpdate = Schema.Schema.Type<typeof SiteUpdate>;

export const SiteListBySubdomain = Schema.Struct({
  subdomain: Schema.String,
});

export type TSiteListBySubdomain = Schema.Schema.Type<
  typeof SiteListBySubdomain
>;
