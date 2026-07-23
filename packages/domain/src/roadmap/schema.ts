import {
  RoadmapId,
  WorkspaceId,
} from "@feeblo/id";
import * as S from "effect/Schema";

/** A roadmap filter with no conditions intentionally matches every workspace post. */
export const RoadmapMode = S.Literals(["status", "filtered"]);
export type TRoadmapMode = S.Schema.Type<typeof RoadmapMode>;

export const RoadmapVisibility = S.Literals(["public", "private"]);
export type TRoadmapVisibility = S.Schema.Type<typeof RoadmapVisibility>;

const FilterValue = S.Array(S.String).check(S.isLengthBetween(1, 50));

export const BoardRoadmapFilterCondition = S.Struct({
  field: S.Literal("boardId"),
  operator: S.Literal("in"),
  value: FilterValue,
});

export const StatusRoadmapFilterCondition = S.Struct({
  field: S.Literal("status"),
  operator: S.Literal("in"),
  value: FilterValue,
});

export const TagRoadmapFilterCondition = S.Struct({
  field: S.Literal("tagId"),
  operator: S.Literals(["containsAny", "containsAll"]),
  value: FilterValue,
});

export const SimpleRoadmapFilterCondition = S.Union([
  BoardRoadmapFilterCondition,
  StatusRoadmapFilterCondition,
  TagRoadmapFilterCondition
]);
export type TSimpleRoadmapFilterCondition = S.Schema.Type<
  typeof SimpleRoadmapFilterCondition
>;

export const SimpleRoadmapFilter = S.Struct({
  version: S.Literal(1),
  operator: S.Literal("and"),
  conditions: S.Array(SimpleRoadmapFilterCondition).check(S.isMaxLength(50)),
});
export type TSimpleRoadmapFilter = S.Schema.Type<typeof SimpleRoadmapFilter>;

export const Roadmap = S.Struct({
  id: S.String,
  name: S.String,
  slug: S.String,
  description: S.NullOr(S.String),
  isPrimary: S.Boolean,
  mode: RoadmapMode,
  visibility: RoadmapVisibility,
  filter: SimpleRoadmapFilter,
  organizationId: S.String,
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
});
export type TRoadmap = S.Schema.Type<typeof Roadmap>;

const RoadmapCreateFields = {
  id: RoadmapId.schema,
  organizationId: WorkspaceId.schema,
  name: S.String.check(S.isLengthBetween(1, 120)),
  slug: S.String.check(S.isLengthBetween(1, 120)),
  description: S.optional(S.NullOr(S.String.check(S.isMaxLength(2_000)))),
  isPrimary: S.optional(S.Boolean),
  visibility: RoadmapVisibility,
  filter: SimpleRoadmapFilter,
};

export const RoadmapCreate = S.Struct({ ...RoadmapCreateFields, mode: RoadmapMode });
export type TRoadmapCreate = S.Schema.Type<typeof RoadmapCreate>;

const RoadmapUpdateFields = { ...RoadmapCreateFields, description: S.NullOr(S.String.check(S.isMaxLength(2_000))), isPrimary: S.Boolean };
export const RoadmapUpdate = S.Struct({ ...RoadmapUpdateFields, mode: RoadmapMode });
export type TRoadmapUpdate = S.Schema.Type<typeof RoadmapUpdate>;

export const RoadmapList = S.Struct({ organizationId: WorkspaceId.schema });
export type TRoadmapList = S.Schema.Type<typeof RoadmapList>;

export const RoadmapBySlug = S.Struct({
  organizationId: WorkspaceId.schema,
  slug: S.String,
});
export type TRoadmapBySlug = S.Schema.Type<typeof RoadmapBySlug>;

export const RoadmapDelete = S.Struct({
  id: RoadmapId.schema,
  organizationId: WorkspaceId.schema,
});
export type TRoadmapDelete = S.Schema.Type<typeof RoadmapDelete>;
