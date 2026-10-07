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

/**
 * The wire shape of a feedback request: the encoded side of the schema the
 * endpoint decodes. The iframe types the body it sends with this, so the
 * client's request and the server's decode are one declaration without the
 * client re-validating input the server owns.
 */
export type TWidgetFeedbackCreateWire = S.Codec.Encoded<
  typeof WidgetFeedbackCreate
>;

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

export type TWidgetSuggestion = S.Schema.Type<typeof WidgetSuggestion>;

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

/**
 * The error body every widget endpoint publishes for a refusal.
 *
 * The iframe decodes this instead of casting `{ message?: string }` at the
 * call site, so a server-side rename fails at the boundary rather than
 * rendering the fallback message for a real one.
 */
export const WidgetError = S.Struct({
  message: S.optional(S.String),
});

export type TWidgetError = S.Schema.Type<typeof WidgetError>;

/**
 * A value in the identity the embedding page posts to the iframe.
 *
 * The identity is the widget's other wire boundary: the SDK normalizes the
 * embedder's `UserIdentity` and posts it as the `IDENTIFY` message, and the
 * iframe posts the public half back as `IDENTITY_CHANGED`. It is JSON, so the
 * value space is `S.Json`; the fields the widget reads are declared once here
 * instead of twice — in the SDK's hand-written `UserIdentity` and the iframe's
 * narrower copy.
 */
export const WidgetIdentityValue = S.Json;

export type TWidgetIdentityValue = S.Schema.Type<typeof WidgetIdentityValue>;

export const WidgetIdentityCompany = S.Struct({
  id: S.NonEmptyString,
  name: S.String,
  avatar: S.optional(S.String),
  customFields: S.optional(S.Record(S.String, WidgetIdentityValue)),
});

export type TWidgetIdentityCompany = S.Schema.Type<
  typeof WidgetIdentityCompany
>;

export const WidgetIdentity = S.Struct({
  id: S.NonEmptyString,
  avatar: S.optional(S.String),
  companies: S.optional(S.Array(WidgetIdentityCompany)),
  customFields: S.optional(S.Record(S.String, WidgetIdentityValue)),
  email: S.optional(S.String),
  name: S.optional(S.String),
  token: S.optional(S.String),
});

export type TWidgetIdentity = S.Schema.Type<typeof WidgetIdentity>;

/**
 * Runtime guard for the `IDENTIFY` message data, so the iframe stores the
 * contract's identity rather than any object that happens to carry an `id`.
 */
export const isWidgetIdentity = S.is(WidgetIdentity);

/**
 * The organization id the shell embeds and both runtimes decode.
 *
 * It is the domain's workspace id rather than a second string type, so the
 * route parameter and the `window.global.__ENV` value cannot drift into two
 * vocabularies for the same identifier.
 */
export const WidgetOrganizationId = WorkspaceId.schema;

export type TWidgetOrganizationId = S.Schema.Type<typeof WidgetOrganizationId>;

/**
 * The subset of the shell's `window.global.__ENV` the iframe reads.
 *
 * The shell injects more than this (the public runtime environment and the
 * widget configuration); the iframe decodes only the two values it builds
 * requests from, so a missing or renamed key throws at boot instead of
 * producing a request to `undefined`.
 */
export const WidgetBootEnv = S.Struct({
  API_URL: S.String,
  organizationId: WidgetOrganizationId,
});

export type TWidgetBootEnv = S.Schema.Type<typeof WidgetBootEnv>;

/**
 * The wire decoders, one per response.
 *
 * They live beside the schemas so both runtimes call the same function: the
 * iframe's fetch helpers decode every response through them, and a payload
 * that stops satisfying the contract throws in the iframe where the visitor
 * is instead of leaking `undefined` into the UI. The server already decodes
 * requests and encodes responses through these same schemas, so this is the
 * other half of one declaration.
 */
export const decodeWidgetBoards = S.decodeUnknownSync(S.Array(WidgetBoard));
export const decodeWidgetUpdates = S.decodeUnknownSync(S.Array(WidgetUpdate));
export const decodeWidgetSuggestions = S.decodeUnknownSync(
  S.Array(WidgetSuggestion)
);
export const decodeWidgetError = S.decodeUnknownSync(WidgetError);
export const decodeWidgetBootEnv = S.decodeUnknownSync(WidgetBootEnv);

/**
 * The organization id decoder the shell uses. It is non-throwing so a
 * malformed id follows the route's 404 path instead of escaping its handler
 * as a 500. The iframe's boot decoder stays strict: a bad id there throws at
 * boot, where the visitor is.
 */
export const decodeWidgetOrganizationIdOption =
  S.decodeUnknownOption(WidgetOrganizationId);
