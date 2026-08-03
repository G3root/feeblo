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
  metadata: S.optional(S.Record(S.String, S.String)),
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

export const WidgetSuggestionRequest = S.Struct({
  boardId: BoardId.schema,
  organizationId: WorkspaceId.schema,
  title: S.String.check(S.isMaxLength(200)),
  content: S.String.check(S.isMaxLength(20_000)),
});

export const WidgetSuggestion = S.Struct({
  id: S.String,
  title: S.String,
  excerpt: S.String,
  slug: S.String,
});

export const WidgetUpdate = S.Struct({
  id: S.String,
  title: S.String,
  slug: S.String,
  content: S.String,
  excerpt: S.String,
  imageUrl: S.NullOr(S.String),
  publishedAt: S.DateFromString,
});

export type TWidgetUpdate = S.Schema.Type<typeof WidgetUpdate>;
