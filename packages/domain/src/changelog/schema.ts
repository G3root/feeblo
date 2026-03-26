import { Schema } from "effect";

export const ChangelogStatus = Schema.Literal(
  "draft",
  "scheduled",
  "published"
);

export type TChangelogStatus = Schema.Schema.Type<typeof ChangelogStatus>;

export const Changelog = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  slug: Schema.String,
  content: Schema.String,
  status: ChangelogStatus,
  scheduledAt: Schema.NullOr(Schema.Date),
  publishedAt: Schema.NullOr(Schema.Date),
  organizationId: Schema.String,
  creatorMemberId: Schema.NullOr(Schema.String),
  creatorId: Schema.NullOr(Schema.String),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
  user: Schema.Struct({
    name: Schema.NullOr(Schema.String),
    image: Schema.NullOr(Schema.String),
  }),
});

export type TChangelog = Schema.Schema.Type<typeof Changelog>;

export const ChangelogList = Schema.Struct({
  organizationId: Schema.String,
});

export type TChangelogList = Schema.Schema.Type<typeof ChangelogList>;

export const ChangelogCreate = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  slug: Schema.String,
  content: Schema.String,
  status: ChangelogStatus,
  scheduledAt: Schema.NullOr(Schema.Date),
  publishedAt: Schema.NullOr(Schema.Date),
  organizationId: Schema.String,
});

export type TChangelogCreate = Schema.Schema.Type<typeof ChangelogCreate>;

export const ChangelogUpdate = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  slug: Schema.String,
  content: Schema.String,
  status: ChangelogStatus,
  scheduledAt: Schema.NullOr(Schema.Date),
  publishedAt: Schema.NullOr(Schema.Date),
  organizationId: Schema.String,
});

export type TChangelogUpdate = Schema.Schema.Type<typeof ChangelogUpdate>;

export const ChangelogDelete = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
});

export type TChangelogDelete = Schema.Schema.Type<typeof ChangelogDelete>;
