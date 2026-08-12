import { currentDb, Database, schema } from "@feeblo/db";
import {
  asLegid,
  IntegrationEventId,
  PostId,
  UserId,
  WorkspaceId,
} from "@feeblo/id";
import { IntegrationEventRecorder } from "@feeblo/integration-core";
import {
  makeSlackApiClient,
  SLACK_FEEDBACK_MODAL_CALLBACK_ID,
  type SlackApiClient,
} from "@feeblo/integration-slack";
import { decryptSlackCredentialMaterial } from "@feeblo/integration-slack/credentials";
import type {
  SlackInteractivePayload,
  SlackMessageActionPayload,
  SlackSlashCommandPayload,
  SlackViewSubmissionPayload,
} from "@feeblo/integration-slack/inbound-schema";
import { slackProviderKey } from "@feeblo/integration-slack/manifest";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { sanitizeMarkdown } from "@feeblo/utils/markdown-sanitizer";
import { truncate } from "@feeblo/utils/text";
import { and, eq, or, sql } from "drizzle-orm";
import * as EffectArray from "effect/Array";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { BoardRepository } from "../../board/repository";
import { EmailOutboxConfig } from "../../email-outbox/config";
import {
  PostEmbeddingService,
  schedulePostEmbeddingBestEffort,
} from "../../post/embedding-service";
import { PostRepository } from "../../post/repository";
import { PostStatusRepository } from "../../post-status/repository";
import { PostSubscriptionRepository } from "../../post-subscription/repository";
import { SlackIntegrationConfig } from "./config";
import {
  type SlackInboundHttpResponse,
  SlackInboundService,
} from "./inbound-service";

/** Internal inbound failure; surfaced to Slack as an ephemeral error. */
export class SlackInboundFailure extends Data.TaggedError(
  "SlackInboundFailure"
)<{
  readonly message: string;
}> {}

const TITLE_MAX_LENGTH = 200;
const DETAILS_MAX_LENGTH = 3000;
const SYNTHETIC_SLACK_EMAIL_SUFFIX = "@slack.invalid";

/** Private metadata embedded in the feedback modal; safe to send to Slack. */
const FeedbackModalMetadata = Schema.Struct({
  channelId: Schema.String,
  channelName: Schema.String,
  connectionId: Schema.String,
  messageTs: Schema.optionalKey(Schema.String),
  organizationId: Schema.String,
  teamId: Schema.String,
});

const decodeModalMetadata = (value: string) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(FeedbackModalMetadata))(
    value
  );

const ephemeralResponse = (text: string): SlackInboundHttpResponse => ({
  body: { response_type: "ephemeral", text },
  status: 200,
});

const clearResponse = (): SlackInboundHttpResponse => ({
  body: { response_action: "clear" },
  status: 200,
});

/** Empty 200 acknowledgment: Slack displays nothing to the user. */
const emptyResponse = (): SlackInboundHttpResponse => ({
  status: 200,
});

/** Creates the Slack inbound service with an injectable API client. */
export const makeSlackInboundServiceLive = (
  apiClient: SlackApiClient = makeSlackApiClient()
): Layer.Layer<
  SlackInboundService,
  never,
  | Database.Database
  | SlackIntegrationConfig
  | BoardRepository
  | EmailOutboxConfig
  | IntegrationEventRecorder
  | PostRepository
  | PostStatusRepository
  | PostSubscriptionRepository
> =>
  Layer.effect(
    SlackInboundService,
    Effect.gen(function* () {
      const db = yield* currentDb;
      const config = yield* SlackIntegrationConfig;
      const boardRepository = yield* BoardRepository;
      const postRepository = yield* PostRepository;
      const postStatusRepository = yield* PostStatusRepository;
      const postSubscriptionRepository = yield* PostSubscriptionRepository;
      const emailOutboxConfig = yield* EmailOutboxConfig;
      const eventRecorder = yield* IntegrationEventRecorder;
      const embeddingService =
        yield* Effect.serviceOption(PostEmbeddingService);

      // Inlined variant of the shared post-event recorder: same canonical
      // event, but every dependency is captured as a value so the inbound
      // service methods stay requirement-free.
      const recordSlackPostIntegrationEvent = ({
        boardId,
        organizationId,
        postId,
        postSlug,
        statusId,
        title,
      }: {
        readonly boardId: string;
        readonly organizationId: string;
        readonly postId: string;
        readonly postSlug: string;
        readonly statusId: string;
        readonly title: string;
      }) =>
        Effect.gen(function* () {
          const [board] = yield* db
            .select({
              id: schema.boardTable.id,
              name: schema.boardTable.name,
              slug: schema.boardTable.slug,
            })
            .from(schema.boardTable)
            .where(
              and(
                eq(schema.boardTable.id, boardId),
                eq(schema.boardTable.organizationId, organizationId)
              )
            )
            .limit(1);
          if (board === undefined) {
            return yield* new SlackInboundFailure({
              message: "Slack post board was not found",
            });
          }
          const statusType = yield* postRepository.findStatusType({
            id: statusId,
            organizationId,
          });
          if (statusType === undefined) {
            return yield* new SlackInboundFailure({
              message: "Slack post status was not found",
            });
          }
          const eventId = yield* IntegrationEventId.generate;
          const correlationId = yield* IntegrationEventId.generate;
          const url = new URL(
            `/${encodeURIComponent(organizationId)}/post/${encodeURIComponent(board.slug)}/${encodeURIComponent(postSlug)}`,
            emailOutboxConfig.appUrl
          ).href;
          yield* eventRecorder
            .recordIntegrationEvent({
              event: {
                causalHopCount: 0,
                correlationId,
                data: {
                  actor: { kind: "end_user" },
                  board,
                  post: {
                    id: postId,
                    status: { id: statusId, type: statusType },
                    title,
                    url,
                  },
                },
                id: eventId,
                occurredAt: yield* DateTime.now,
                organizationId: asLegid(WorkspaceId)(organizationId),
                origin: { kind: "feeblo" },
                type: "feedback.post.created",
                version: 1,
              },
            })
            .pipe(
              Effect.mapError(
                () =>
                  new SlackInboundFailure({
                    message: "Could not record post integration event",
                  })
              )
            );
        });

      const findActiveConnection = (teamId: string) =>
        db
          .select()
          .from(schema.integrationConnectionTable)
          .where(
            and(
              eq(schema.integrationConnectionTable.provider, slackProviderKey),
              eq(schema.integrationConnectionTable.remoteAccountId, teamId),
              eq(schema.integrationConnectionTable.lifecycle, "active")
            )
          )
          .limit(1)
          .pipe(Effect.map(EffectArray.get(0)));

      const loadBotToken = (connection: {
        readonly credentialsCiphertext: string | null;
      }): Effect.Effect<Option.Option<Redacted.Redacted<string>>, Error> =>
        connection.credentialsCiphertext === null
          ? Effect.succeed(Option.none())
          : decryptSlackCredentialMaterial(
              config.encryptionKey,
              connection.credentialsCiphertext
            ).pipe(
              Effect.mapError(
                () =>
                  new SlackInboundFailure({
                    message: "Slack credentials could not be decrypted",
                  })
              ),
              Effect.map((credentials) =>
                credentials.botToken === undefined
                  ? Option.none()
                  : Option.some(credentials.botToken)
              )
            );

      const buildFeedbackModal = ({
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
      }): unknown => ({
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
              options: boards.map((board) => ({
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

      const buildSuccessModal = ({
        postTitle,
        postUrl,
      }: {
        readonly postTitle: string;
        readonly postUrl?: string;
      }): unknown => ({
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

      const openFeedbackModal = ({
        botToken,
        connectionId,
        messageTs,
        organizationId,
        teamId,
        triggerId,
        channelId,
        channelName,
        initialTitle,
      }: {
        readonly botToken: Redacted.Redacted<string>;
        readonly channelId: string;
        readonly channelName: string;
        readonly connectionId: string;
        readonly initialTitle: string;
        readonly messageTs?: string;
        readonly organizationId: string;
        readonly triggerId: string;
        readonly teamId: string;
      }) =>
        Effect.gen(function* () {
          const boards = yield* boardRepository.findMany({ organizationId });
          if (boards.length === 0) {
            return ephemeralResponse(
              "Feeblo has no boards configured yet. Ask an admin to create one."
            );
          }
          const metadata = yield* Schema.encodeEffect(
            Schema.fromJsonString(FeedbackModalMetadata)
          )({
            channelId,
            channelName,
            connectionId,
            organizationId,
            teamId,
            ...(messageTs === undefined ? {} : { messageTs }),
          }).pipe(
            Effect.mapError(
              () =>
                new SlackInboundFailure({
                  message: "Could not encode feedback modal metadata",
                })
            )
          );
          const view = buildFeedbackModal({
            boards,
            initialTitle,
            metadata,
          });
          // Open the modal through views.open with the invocation's
          // trigger_id: this is the response path every Slack surface
          // supports (slash commands and shortcuts alike). The HTTP
          // response carries an empty acknowledgment so Slack displays
          // nothing — no stray message next to the modal.
          yield* apiClient.viewsOpen({ botToken, triggerId, view }).pipe(
            Effect.mapError(
              () =>
                new SlackInboundFailure({
                  message: "Could not open the Feeblo feedback form",
                })
            )
          );
          return emptyResponse();
        });

      const resolveSlackUser = ({
        botToken,
        organizationId,
        slackTeamId,
        slackUserId,
      }: {
        readonly botToken: Redacted.Redacted<string>;
        readonly organizationId: string;
        readonly slackTeamId: string;
        readonly slackUserId: string;
      }) =>
        Effect.gen(function* () {
          // Fetch the Slack profile best-effort; fall back to the username
          // when the profile lookup fails.
          const profile = yield* Effect.exit(
            apiClient.usersInfo({ botToken, userId: slackUserId })
          );
          const displayName = Exit.isSuccess(profile)
            ? (profile.value.user.real_name ??
              profile.value.user.profile?.display_name ??
              profile.value.user.profile?.real_name ??
              profile.value.user.name ??
              slackUserId)
            : slackUserId;
          const email = Exit.isSuccess(profile)
            ? profile.value.user.profile?.email
            : undefined;
          // 1. SSO-style linking: a visible email that matches an existing
          // Feeblo user of this organization reuses that account, so Slack
          // feedback lands on the person's real profile. Matching is scoped
          // to users of this organization (SSO users are restricted to it;
          // members hold a membership row).
          if (email !== undefined) {
            const [match] = yield* db
              .select({ id: schema.userTable.id })
              .from(schema.userTable)
              .where(
                and(
                  eq(schema.userTable.email, email),
                  or(
                    eq(
                      schema.userTable.restrictedToOrganizationId,
                      organizationId
                    ),
                    sql`EXISTS (
                      SELECT 1 FROM ${schema.memberTable}
                      WHERE ${schema.memberTable.userId} = ${schema.userTable.id}
                        AND ${schema.memberTable.organizationId} = ${organizationId}
                    )`
                  )
                )
              )
              .limit(1);
            if (match !== undefined) {
              return match.id;
            }
          }
          // 2. Stable anonymous identity: the synthetic email derived from the
          // team + slack user id maps every future submission back to the same
          // user, without a dedicated link table. Team-scoped so the same
          // slack id in two workspaces can never collide.
          const syntheticEmail = `slack-${slackTeamId.toLowerCase()}-${slackUserId.toLowerCase()}${SYNTHETIC_SLACK_EMAIL_SUFFIX}`;
          const [existing] = yield* db
            .select({ id: schema.userTable.id })
            .from(schema.userTable)
            .where(eq(schema.userTable.email, syntheticEmail))
            .limit(1);
          if (existing !== undefined) {
            return existing.id;
          }
          // 3. Create the anonymous user. These users never receive
          // transactional email (synthetic address, emailVerified false).
          const userId = yield* UserId.generate;
          yield* db
            .insert(schema.userTable)
            .values({
              email: syntheticEmail,
              emailVerified: false,
              id: userId,
              name: truncate(displayName, 100),
            })
            .pipe(Effect.ignore);
          // Concurrent submissions may create the same user; the insert
          // conflict is ignored and the winner is reused.
          const [winner] = yield* db
            .select({ id: schema.userTable.id })
            .from(schema.userTable)
            .where(eq(schema.userTable.email, syntheticEmail))
            .limit(1);
          return winner?.id ?? userId;
        });

      const createPostFromSlack = ({
        boardId,
        content,
        organizationId,
        title,
        userId,
      }: {
        readonly boardId: string;
        readonly content: string;
        readonly organizationId: string;
        readonly title: string;
        readonly userId: string;
      }) =>
        Effect.gen(function* () {
          const statuses = yield* postStatusRepository.findMany({
            organizationId,
          });
          const defaultStatus = statuses[0];
          if (defaultStatus === undefined) {
            return yield* new SlackInboundFailure({
              message: "Organization has no default post status",
            });
          }
          const { sanitizedMarkdown, sanitizedHtml } =
            sanitizeMarkdown(content);
          const id = yield* PostId.generate;
          const excerpt = htmlToExcerpt(sanitizedHtml);
          const [board] = yield* db
            .select({ slug: schema.boardTable.slug })
            .from(schema.boardTable)
            .where(
              and(
                eq(schema.boardTable.id, boardId),
                eq(schema.boardTable.organizationId, organizationId)
              )
            )
            .limit(1);
          if (board === undefined) {
            return yield* new SlackInboundFailure({
              message: "Slack post board was not found",
            });
          }
          const boardSlug = board.slug;
          let slug = "";
          yield* db.transaction(() =>
            Effect.gen(function* () {
              slug = yield* postRepository.create({
                boardId,
                content: sanitizedMarkdown,
                creatorId: userId,
                creatorMemberId: null,
                excerpt,
                id,
                organizationId,
                source: "SLACK",
                statusId: defaultStatus.id,
                title,
              });
              yield* recordSlackPostIntegrationEvent({
                boardId,
                organizationId,
                postId: id,
                postSlug: slug,
                statusId: defaultStatus.id,
                title,
              });
              yield* postSubscriptionRepository.subscribe({
                organizationId,
                postId: id,
                userId,
              });
            })
          );
          yield* schedulePostEmbeddingBestEffort({
            content: sanitizedMarkdown,
            postId: id,
            organizationId,
            title,
            ...(embeddingService._tag === "Some"
              ? { embeddingService: embeddingService.value }
              : {}),
          }).pipe(Effect.provideService(Database.Database, db));
          return { boardId, boardSlug, id, slug, title };
        });

      const handleViewSubmission = (payload: SlackViewSubmissionPayload) =>
        Effect.gen(function* () {
          const metadata = yield* decodeModalMetadata(
            payload.view.private_metadata
          ).pipe(
            Effect.mapError(
              () =>
                new SlackInboundFailure({
                  message: "Feedback modal metadata is invalid",
                })
            )
          );
          const connection = yield* findActiveConnection(metadata.teamId);
          if (connection._tag === "None") {
            return clearResponse();
          }
          const botTokenOption = yield* loadBotToken(connection.value);
          if (botTokenOption._tag === "None") {
            return clearResponse();
          }
          const botToken = botTokenOption.value;
          const values = payload.view.state.values;
          const titleInput = values.feeblo_title?.title;
          const title = titleInput?.value?.trim() ?? "";
          if (title.length === 0) {
            return {
              body: {
                errors: {
                  feeblo_title: "Please enter a title.",
                },
                response_action: "errors",
              },
              status: 200,
            };
          }
          const details = values.feeblo_details?.details?.value?.trim() ?? "";
          const boardId = values.feeblo_board?.board?.selected_option?.value;
          if (boardId === undefined) {
            return {
              body: {
                errors: {
                  feeblo_board: "Please choose a board.",
                },
                response_action: "errors",
              },
              status: 200,
            };
          }
          const userId = yield* resolveSlackUser({
            botToken,
            organizationId: metadata.organizationId,
            slackTeamId: metadata.teamId,
            slackUserId: payload.user.id,
          });
          const created = yield* createPostFromSlack({
            boardId,
            content: details,
            organizationId: metadata.organizationId,
            title,
            userId,
          });
          // Swap the form modal for a success dialog. response_action:
          // "update" replaces the current view, so the user gets a clear
          // confirmation instead of the modal silently closing.
          const postUrl =
            created.boardSlug.length > 0
              ? `${emailOutboxConfig.appUrl}/${encodeURIComponent(metadata.organizationId)}/post/${encodeURIComponent(created.boardSlug)}/${encodeURIComponent(created.slug)}`
              : undefined;
          return {
            body: {
              response_action: "update",
              view: buildSuccessModal({
                postTitle: created.title,
                ...(postUrl === undefined ? {} : { postUrl }),
              }),
            },
            status: 200,
          };
        });

      const handleMessageAction = (payload: SlackMessageActionPayload) =>
        Effect.gen(function* () {
          const connection = yield* findActiveConnection(payload.team.id);
          if (connection._tag === "None") {
            return ephemeralResponse(
              "Feeblo is not connected to this Slack workspace yet."
            );
          }
          const botTokenOption = yield* loadBotToken(connection.value);
          if (botTokenOption._tag === "None") {
            return ephemeralResponse(
              "Feeblo is not connected to this Slack workspace yet."
            );
          }
          const messageText = payload.message.text.trim();
          return yield* openFeedbackModal({
            botToken: botTokenOption.value,
            channelId: payload.channel.id,
            channelName: payload.channel.name,
            connectionId: connection.value.id,
            initialTitle: messageText,
            messageTs: payload.message.ts,
            organizationId: connection.value.organizationId,
            triggerId: payload.trigger_id,
            teamId: payload.team.id,
          });
        });

      const handleSlashCommand = (payload: SlackSlashCommandPayload) =>
        Effect.gen(function* () {
          const connection = yield* findActiveConnection(payload.team_id);
          if (connection._tag === "None") {
            return ephemeralResponse(
              "Feeblo is not connected to this Slack workspace yet. Ask an admin to connect it in the Feeblo dashboard."
            );
          }
          const botTokenOption = yield* loadBotToken(connection.value);
          if (botTokenOption._tag === "None") {
            return ephemeralResponse(
              "Feeblo is not connected to this Slack workspace yet. Ask an admin to connect it in the Feeblo dashboard."
            );
          }
          const text = payload.text.trim();
          return yield* openFeedbackModal({
            botToken: botTokenOption.value,
            channelId: payload.channel_id,
            channelName: payload.channel_name,
            connectionId: connection.value.id,
            initialTitle: text,
            organizationId: connection.value.organizationId,
            triggerId: payload.trigger_id,
            teamId: payload.team_id,
          });
        });

      const handleInteractive = (payload: SlackInteractivePayload) =>
        Effect.gen(function* () {
          switch (payload.type) {
            case "message_action":
              return yield* handleMessageAction(payload);
            case "view_submission":
              // A view_submission response must be a valid response_action
              // (clear/update/push/errors); any other body makes Slack reject
              // the dispatch. On failure, log the cause and close the modal
              // so the user never sees a raw error.
              return yield* handleViewSubmission(payload).pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("Slack view submission failed", {
                    cause,
                  }).pipe(Effect.as(clearResponse()))
                )
              );
            case "block_actions":
              // Notification message buttons are URL buttons and never
              // produce block_actions callbacks; answer emptily to any
              // stray interaction.
              return { body: {}, status: 200 };
            default:
              // Unknown interactive payloads are acknowledged emptily so Slack
              // sees a definitive answer; `payload.type` is a closed union, so
              // this arm is defensive only.
              return { body: {}, status: 200 };
          }
        });

      const withFallback = (
        effect: Effect.Effect<SlackInboundHttpResponse, unknown>
      ): Effect.Effect<SlackInboundHttpResponse, never> =>
        effect.pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Slack inbound request failed", { cause }).pipe(
              Effect.as(
                ephemeralResponse(
                  "Something went wrong while sending your feedback to Feeblo. Please try again."
                )
              )
            )
          )
        );

      return {
        handleInteractive: (payload) =>
          withFallback(handleInteractive(payload)),
        handleSlashCommand: (payload) =>
          withFallback(handleSlashCommand(payload)),
      };
    })
  );

/** Live layer with the default fetch-backed Slack API client. */
export const SlackInboundServiceLive = makeSlackInboundServiceLive();
