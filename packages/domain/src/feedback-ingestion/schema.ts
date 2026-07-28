import {
  BoardId,
  FeedbackReceiptId,
  FeedbackTriageItemId,
  PostId,
  PostStatusId,
  WorkspaceId,
} from "@feeblo/id";
import * as S from "effect/Schema";

export const FeedbackChannelKind = S.Literals([
  "WIDGET",
  "PUBLIC_PORTAL",
  "DASHBOARD",
  "API",
  "CSV_IMPORT",
  "SLACK",
  "EMAIL",
]);

export type TFeedbackChannelKind = S.Schema.Type<typeof FeedbackChannelKind>;

const NonBlankString = S.String.check(S.isPattern(/\S/));
const FeedbackKey = NonBlankString.check(S.isMaxLength(255));
const FeedbackText = S.String.check(S.isMaxLength(10_000));
const FeedbackMetadata = S.Record(
  S.String.check(S.isMaxLength(128)),
  S.MutableJson
);

export const FeedbackSender = S.Struct({
  upstreamId: S.optional(S.String),
  email: S.optional(S.String),
  name: S.optional(S.String),
});

export const FeedbackMessage = S.Struct({
  text: FeedbackText,
  title: S.optional(FeedbackText),
});

export const CaptureFeedback = S.Struct({
  organizationId: WorkspaceId.schema,
  channel: S.Struct({
    key: FeedbackKey,
    kind: FeedbackChannelKind,
    label: S.String,
  }),
  upstreamItemId: S.optional(S.String),
  deliveryKey: FeedbackKey,
  sender: FeedbackSender,
  message: FeedbackMessage,
  metadata: S.optional(FeedbackMetadata),
});

export type TCaptureFeedback = S.Schema.Type<typeof CaptureFeedback>;

export const CaptureFeedbackResult = S.Struct({
  status: S.Literals(["CREATED", "DUPLICATE"]),
  receiptId: FeedbackReceiptId.schema,
});

export type TCaptureFeedbackResult = S.Schema.Type<
  typeof CaptureFeedbackResult
>;

export const FeedbackTriageStatus = S.Literals([
  "OPEN",
  "POST_CREATED",
  "POST_LINKED",
  "IGNORED",
]);

export const FeedbackTriageAction = S.Literals([
  "CREATE_POST",
  "LINK_POST",
  "REVIEW",
]);

export const FeedbackTriageItem = S.Struct({
  id: FeedbackTriageItemId.schema,
  organizationId: WorkspaceId.schema,
  receiptId: FeedbackReceiptId.schema,
  action: FeedbackTriageAction,
  status: FeedbackTriageStatus,
  channelKind: FeedbackChannelKind,
  channelLabel: S.String,
  senderName: S.NullOr(S.String),
  senderEmail: S.NullOr(S.String),
  contactId: S.NullOr(S.String),
  digest: S.String,
  excerpts: S.Array(S.String),
  customerNeed: S.NullOr(S.String),
  tone: S.NullOr(S.Literals(["NEGATIVE", "NEUTRAL", "POSITIVE"])),
  priority: S.NullOr(S.Literals(["LOW", "MEDIUM", "HIGH", "CRITICAL"])),
  interpretationConfidence: S.NullOr(S.Number),
  proposedTitle: S.NullOr(S.String),
  proposedBody: S.NullOr(S.String),
  proposedBoardId: S.NullOr(S.String),
  proposedPostId: S.NullOr(S.String),
  rationale: S.NullOr(S.String),
  createdAt: S.DateFromString,
});

export type TFeedbackTriageItem = S.Schema.Type<typeof FeedbackTriageItem>;

export const FeedbackTriageList = S.Struct({
  organizationId: WorkspaceId.schema,
  status: S.optional(FeedbackTriageStatus),
  pageSize: S.Number.check(
    S.isInt(),
    S.isGreaterThanOrEqualTo(1),
    S.isLessThanOrEqualTo(100)
  ),
  cursor: S.optional(
    S.Struct({
      createdAt: S.DateFromString,
      id: FeedbackTriageItemId.schema,
    })
  ),
});

export type TFeedbackTriageList = S.Schema.Type<typeof FeedbackTriageList>;

export const FeedbackTriagePage = S.Struct({
  items: S.Array(FeedbackTriageItem),
  nextCursor: S.NullOr(
    S.Struct({
      createdAt: S.DateFromString,
      id: FeedbackTriageItemId.schema,
    })
  ),
});

export const FeedbackTriageCreatePost = S.Struct({
  organizationId: WorkspaceId.schema,
  triageItemId: FeedbackTriageItemId.schema,
  boardId: BoardId.schema,
  statusId: PostStatusId.schema,
  title: S.optional(S.String),
  content: S.optional(S.String),
});

export type TFeedbackTriageCreatePost = S.Schema.Type<
  typeof FeedbackTriageCreatePost
>;

export const FeedbackTriageLinkPost = S.Struct({
  organizationId: WorkspaceId.schema,
  triageItemId: FeedbackTriageItemId.schema,
  postId: PostId.schema,
});

export type TFeedbackTriageLinkPost = S.Schema.Type<
  typeof FeedbackTriageLinkPost
>;

export const FeedbackTriageIgnore = S.Struct({
  organizationId: WorkspaceId.schema,
  triageItemId: FeedbackTriageItemId.schema,
});

export type TFeedbackTriageIgnore = S.Schema.Type<typeof FeedbackTriageIgnore>;

export const FeedbackTriageResolution = S.Struct({
  postId: S.NullOr(PostId.schema),
  status: S.Literals(["POST_CREATED", "POST_LINKED", "IGNORED"]),
});

export type TFeedbackTriageResolution = S.Schema.Type<
  typeof FeedbackTriageResolution
>;
