import { BoardId, WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

import {
  WIDGET_CONTENT_MAX_LENGTH,
  WIDGET_METADATA_KEY_MAX_LENGTH,
  WIDGET_METADATA_MAX_PROPERTIES,
  WIDGET_METADATA_VALUE_MAX_LENGTH,
  WIDGET_TITLE_MAX_LENGTH,
  WIDGET_TOKEN_MAX_LENGTH,
} from "../content-limits";

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
  title: S.String.pipe(S.check(S.isMaxLength(WIDGET_TITLE_MAX_LENGTH))),
  // Same bound as WidgetSuggestionRequest. The endpoint is public and the
  // content flows into storage, embeddings, subscriber emails and webhook
  // payloads, so keep it aligned with the suggestions cap instead of 100k.
  content: S.String.pipe(S.check(S.isMaxLength(WIDGET_CONTENT_MAX_LENGTH))),
  metadata: S.optional(
    S.Record(
      S.String.pipe(S.check(S.isMaxLength(WIDGET_METADATA_KEY_MAX_LENGTH))),
      S.String.check(S.isMaxLength(WIDGET_METADATA_VALUE_MAX_LENGTH))
    ).check(S.isMaxProperties(WIDGET_METADATA_MAX_PROPERTIES))
  ),
  token: S.optional(
    S.String.pipe(S.check(S.isMaxLength(WIDGET_TOKEN_MAX_LENGTH)))
  ),
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
  title: S.String.check(S.isMaxLength(WIDGET_TITLE_MAX_LENGTH)),
  content: S.String.check(S.isMaxLength(WIDGET_CONTENT_MAX_LENGTH)),
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
