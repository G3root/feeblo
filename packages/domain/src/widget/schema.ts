import { Schema as S } from "effect";

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
  boardId: S.String,
  organizationId: S.String,
  title: S.String,
  content: S.String,
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
