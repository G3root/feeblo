import { BoardId, WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

export const WidgetBoard = S.Struct({
  id: S.String,
  name: S.String,
  slug: S.String,
  organizationId: S.String,
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
});

export type TWidgetBoard = S.Schema.Type<typeof WidgetBoard>;

export const WidgetBoardList = S.Struct({
  organizationId: S.String,
});

export type TWidgetBoardList = S.Schema.Type<typeof WidgetBoardList>;

export const WidgetFeedbackCreate = S.Struct({
  boardId: BoardId.schema,
  organizationId: WorkspaceId.schema,
  title: S.String,
  content: S.String,
  token: S.optional(S.String),
});

export type TWidgetFeedbackCreate = S.Schema.Type<typeof WidgetFeedbackCreate>;

export const WidgetFeedbackResponse = S.Struct({
  id: S.String,
  slug: S.String,
  title: S.String,
  boardId: S.String,
  organizationId: S.String,
  createdAt: S.DateFromString,
});

export type TWidgetFeedbackResponse = S.Schema.Type<
  typeof WidgetFeedbackResponse
>;

export const WidgetSsoSessionCreate = S.Struct({
  organizationId: WorkspaceId.schema,
  token: S.String,
});

export type TWidgetSsoSessionCreate = S.Schema.Type<
  typeof WidgetSsoSessionCreate
>;

export const WidgetSsoSessionResponse = S.Struct({
  token: S.String,
  user: S.Struct({
    id: S.String,
    name: S.String,
  }),
});

export type TWidgetSsoSessionResponse = S.Schema.Type<
  typeof WidgetSsoSessionResponse
>;
