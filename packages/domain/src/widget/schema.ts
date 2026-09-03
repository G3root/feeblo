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

/**
 * Widget feedback metadata: flat string→string map bounded by
 * {@link content-limits} (max 20 properties, keys ≤ 64 chars, values
 * ≤ 500 chars). The bounds are enforced here at the public wire boundary and
 * re-applied in the handler so the stored JSONB and downstream webhook/email
 * payloads never carry hostile shapes even if the endpoint schema drifts.
 *
 * The key bound is enforced with a record-level check rather than a refined
 * `S.Record` key selector: a failing key selector silently drops the offending
 * entry, so an overlong key would decode to an empty record (and get persisted)
 * instead of failing validation.
 */
export const WidgetFeedbackMetadataValue = S.Record(
  S.String,
  S.String.check(S.isMaxLength(WIDGET_METADATA_VALUE_MAX_LENGTH))
).pipe(
  S.check(
    S.makeFilter(
      (record) =>
        Object.keys(record).every(
          (key) => key.length <= WIDGET_METADATA_KEY_MAX_LENGTH
        ) ||
        `Metadata keys must be at most ${WIDGET_METADATA_KEY_MAX_LENGTH} characters`
    )
  ),
  S.check(S.isMaxProperties(WIDGET_METADATA_MAX_PROPERTIES))
);

export const WidgetFeedbackMetadata = S.optional(WidgetFeedbackMetadataValue);

export type TWidgetFeedbackMetadata = S.Schema.Type<
  typeof WidgetFeedbackMetadataValue
>;

export const WidgetFeedbackCreate = S.Struct({
  boardId: BoardId.schema,
  organizationId: WorkspaceId.schema,
  title: S.String.pipe(S.check(S.isMaxLength(WIDGET_TITLE_MAX_LENGTH))),
  // Same bound as WidgetSuggestionRequest. The endpoint is public and the
  // content flows into storage, embeddings, subscriber emails and webhook
  // payloads, so keep it aligned with the suggestions cap instead of 100k.
  content: S.String.pipe(S.check(S.isMaxLength(WIDGET_CONTENT_MAX_LENGTH))),
  metadata: WidgetFeedbackMetadata,
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
