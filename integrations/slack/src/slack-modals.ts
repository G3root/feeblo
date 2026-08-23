import { SLACK_FEEDBACK_MODAL_CALLBACK_ID } from "@feeblo/integration-slack";
import { truncate } from "@feeblo/utils/text";
import * as Schema from "effect/Schema";

const TITLE_MAX_LENGTH = 200;
const DETAILS_MAX_LENGTH = 3000;
const SUCCESS_FIELD_TEXT_MAX_LENGTH = 2000;
const SUCCESS_FIELDS_PER_SECTION = 10;

const formatSlackMetadataLabel = (value: string): string =>
  value
    .toLowerCase()
    .split("_")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");

const buildSuccessMetadataBlocks = ({
  boardName,
  metadata,
  postId,
  status,
  submitterName,
}: {
  readonly boardName: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly postId: string;
  readonly status: string;
  readonly submitterName: string;
}): readonly unknown[] => {
  const postFields: readonly {
    readonly name: string;
    readonly value: string;
  }[] = [
    { name: "Board", value: boardName },
    { name: "Status", value: formatSlackMetadataLabel(status) },
    { name: "Source", value: "Slack" },
    { name: "Submitted by", value: submitterName || "Slack user" },
    { name: "Post ID", value: postId },
    ...Object.entries(metadata)
      .map(([name, value]) => ({
        name: formatSlackMetadataLabel(name.trim()),
        value: value.trim(),
      }))
      .filter(({ name, value }) => name.length > 0 && value.length > 0),
  ];
  const blocks: unknown[] = [];
  for (
    let startIndex = 0;
    startIndex < postFields.length;
    startIndex += SUCCESS_FIELDS_PER_SECTION
  ) {
    blocks.push({
      fields: postFields
        .slice(startIndex, startIndex + SUCCESS_FIELDS_PER_SECTION)
        .map(({ name, value }) => ({
          text: truncate(`*${name}:*\n${value}`, SUCCESS_FIELD_TEXT_MAX_LENGTH),
          type: "mrkdwn",
        })),
      type: "section",
    });
  }
  return blocks;
};

/** Private metadata embedded in the feedback modal; safe to send to Slack. */
export const FeedbackModalMetadata = Schema.Struct({
  channelId: Schema.String,
  channelName: Schema.String,
  connectionId: Schema.String,
  messageTs: Schema.optionalKey(Schema.String),
  organizationId: Schema.String,
  teamId: Schema.String,
});

export const decodeModalMetadata = (value: string) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(FeedbackModalMetadata))(
    value
  );

/** Slack Block Kit `modal` view document sent to `views.open` / `views.update`. */
export interface SlackModalViewDocument {
  readonly callback_id: string;
  readonly clear_on_close?: boolean;
  readonly close: { readonly text: string; readonly type: "plain_text" };
  readonly private_metadata?: string;
  readonly submit?: { readonly text: string; readonly type: "plain_text" };
  readonly title: { readonly text: string; readonly type: "plain_text" };
  readonly type: "modal";
  readonly blocks: readonly unknown[];
}

/** Slack Block Kit `modal` view that collects a feedback post. */
export const buildFeedbackModal = ({
  boards,
  initialTitle,
  metadata,
}: {
  readonly boards: readonly {
    readonly id: string;
    readonly name: string;
  }[];
  readonly initialTitle: string;
  readonly metadata: string;
}): SlackModalViewDocument => ({
  callback_id: SLACK_FEEDBACK_MODAL_CALLBACK_ID,
  close: { text: "Cancel", type: "plain_text" },
  private_metadata: metadata,
  submit: { text: "Send", type: "plain_text" },
  title: { text: "Send feedback to Feeblo", type: "plain_text" },
  type: "modal",
  blocks: [
    {
      block_id: "feeblo_title",
      element: {
        action_id: "title",
        initial_value: truncate(initialTitle, TITLE_MAX_LENGTH),
        max_length: TITLE_MAX_LENGTH,
        type: "plain_text_input",
      },
      label: { emoji: true, text: "Title", type: "plain_text" },
      type: "input",
    },
    {
      block_id: "feeblo_details",
      element: {
        action_id: "details",
        max_length: DETAILS_MAX_LENGTH,
        multiline: true,
        type: "plain_text_input",
      },
      label: { emoji: true, text: "Details", type: "plain_text" },
      optional: true,
      type: "input",
    },
    {
      block_id: "feeblo_board",
      element: {
        action_id: "board",
        // Slack's static_select accepts at most 100 options; cap the board
        // list so views.open stays valid for organizations with more boards.
        options: boards.slice(0, 100).map((board) => ({
          text: {
            emoji: true,
            text: truncate(board.name, 75),
            type: "plain_text",
          },
          value: board.id,
        })),
        placeholder: {
          text: "Choose a board",
          type: "plain_text",
        },
        type: "static_select",
      },
      label: { emoji: true, text: "Board", type: "plain_text" },
      type: "input",
    },
  ],
});

/** Slack Block Kit `modal` view shown after a feedback post is created. */
export const buildSuccessModal = ({
  boardName,
  metadata,
  postId,
  postTitle,
  postUrl,
  status,
  submitterName,
}: {
  readonly boardName: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly postId: string;
  readonly postTitle: string;
  readonly postUrl?: string;
  readonly status: string;
  readonly submitterName: string;
}): SlackModalViewDocument => ({
  callback_id: "feeblo_feedback_success",
  clear_on_close: true,
  close: { text: "Close", type: "plain_text" },
  title: { text: "Feedback sent", type: "plain_text" },
  type: "modal",
  blocks: [
    {
      text: {
        text: "🎉 Your feedback was sent to Feeblo.",
        type: "mrkdwn",
      },
      type: "section",
    },
    {
      text: {
        text: `*${truncate(postTitle, 150)}*`,
        type: "mrkdwn",
      },
      type: "section",
    },
    ...buildSuccessMetadataBlocks({
      boardName,
      metadata,
      postId,
      status,
      submitterName,
    }),
    ...(postUrl === undefined
      ? []
      : [
          {
            elements: [
              {
                style: "primary",
                text: {
                  emoji: true,
                  text: "View post",
                  type: "plain_text",
                },
                type: "button",
                url: postUrl,
              },
            ],
            type: "actions",
          },
        ]),
  ],
});
