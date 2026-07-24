import { RoadmapColumnId, RoadmapId, WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";
import { SimpleRoadmapFilter } from "../roadmap/schema";

export const StatusRoadmapColumnConfig = S.Struct({
  type: S.Literal("status"),
  statusId: S.String,
});
export const FilteredRoadmapColumnConfig = S.Struct({
  type: S.Literal("filter"),
  filter: SimpleRoadmapFilter,
});
export const RoadmapColumnConfig = S.Union([
  StatusRoadmapColumnConfig,
  FilteredRoadmapColumnConfig,
]);
export type TRoadmapColumnConfig = S.Schema.Type<typeof RoadmapColumnConfig>;

export const RoadmapColumn = S.Struct({
  id: S.String,
  roadmapId: S.String,
  name: S.String.check(S.isLengthBetween(1, 120)),
  position: S.Int,
  config: RoadmapColumnConfig,
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
});
export type TRoadmapColumn = S.Schema.Type<typeof RoadmapColumn>;

/**
 * Read model used by the status-only roadmap UI. Flattening statusId keeps the
 * client collection normalized and makes it directly joinable to post statuses.
 */
export const StatusRoadmapColumn = S.Struct({
  id: S.String,
  roadmapId: S.String,
  name: S.String.check(S.isLengthBetween(1, 120)),
  position: S.Int,
  statusId: S.String,
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
});
export type TStatusRoadmapColumn = S.Schema.Type<
  typeof StatusRoadmapColumn
>;

const ColumnInput = {
  roadmapId: RoadmapId.schema,
  organizationId: WorkspaceId.schema,
  name: S.String.check(S.isLengthBetween(1, 120)),
  position: S.Int,
  config: RoadmapColumnConfig,
};
export const RoadmapColumnCreate = S.Struct({
  id: RoadmapColumnId.schema,
  ...ColumnInput,
});
export type TRoadmapColumnCreate = S.Schema.Type<typeof RoadmapColumnCreate>;
export const RoadmapColumnUpdate = S.Struct({
  id: RoadmapColumnId.schema,
  ...ColumnInput,
});
export type TRoadmapColumnUpdate = S.Schema.Type<typeof RoadmapColumnUpdate>;
export const RoadmapColumnDelete = S.Struct({
  id: RoadmapColumnId.schema,
  roadmapId: RoadmapId.schema,
  organizationId: WorkspaceId.schema,
});
export type TRoadmapColumnDelete = S.Schema.Type<typeof RoadmapColumnDelete>;
export const RoadmapColumnList = S.Struct({
  organizationId: WorkspaceId.schema,
});
export type TRoadmapColumnList = S.Schema.Type<typeof RoadmapColumnList>;
