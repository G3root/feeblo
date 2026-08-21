import {
  currentDb,
  Database,
  gitHubIssueSafeMetadataConditions,
  schema,
} from "@feeblo/db";
import {
  IntegrationExternalResourceType,
  IntegrationProviderKey,
} from "@feeblo/db/validation-schema/integration";
import {
  asLegid,
  BoardId,
  GitHubSyncRuleId,
  GitHubWebhookDeliveryId,
  IntegrationConnectionId,
  PostId,
  PostStatusId,
  WorkspaceId,
} from "@feeblo/id";
import { IntegrationEventRecorder } from "@feeblo/integration-core";
import { and, asc, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { EmailOutboxConfig } from "../../email-outbox/config";
import { NotificationService } from "../../notification/service";
import { PostRepository } from "../../post/repository";
import { InternalServerError, NotFoundError } from "../../rpc-errors";
import { recordPostIntegrationEvent } from "../post-event-recording";
import {
  GitHubInboundService,
  type GitHubInstallationLifecycleWebhook,
  type GitHubIssueWebhook,
} from "./inbound-service";
import { findMatchingGitHubSyncRules } from "./rule-evaluation";

const inboundDatabaseError = (operation: string) => () =>
  new InternalServerError({ message: `GitHub webhook ${operation} failed.` });

const gitHubIssueResourceType = IntegrationExternalResourceType.make("issue");

/** Applies verified GitHub issue webhooks through a transactional inbox before changing a linked Feeblo post. */
const makeGitHubInboundService = Effect.gen(function* () {
  const db = yield* currentDb;
  const notifications = yield* NotificationService;
  const integrationEventRecorder = yield* IntegrationEventRecorder;
  const emailOutboxConfig = yield* EmailOutboxConfig;
  const postRepository = yield* PostRepository;
  const activeConnectionForInstallation = (installationId: string) =>
    db
      .select({
        id: schema.integrationConnectionTable.id,
        organizationId: schema.integrationConnectionTable.organizationId,
      })
      .from(schema.integrationConnectionTable)
      .innerJoin(
        schema.githubInstallationTable,
        eq(
          schema.githubInstallationTable.connectionId,
          schema.integrationConnectionTable.id
        )
      )
      .where(
        and(
          eq(schema.githubInstallationTable.installationId, installationId),
          eq(
            schema.integrationConnectionTable.provider,
            IntegrationProviderKey.make("github")
          ),
          eq(schema.integrationConnectionTable.lifecycle, "active")
        )
      )
      .limit(1)
      .pipe(
        Effect.mapError(inboundDatabaseError("installation connection lookup")),
        Effect.flatMap((rows) =>
          rows[0] === undefined
            ? new NotFoundError({
                message: "Active GitHub App installation was not found.",
              })
            : Effect.succeed(rows[0])
        )
      );
  const applyIssue = (webhook: GitHubIssueWebhook) =>
    db
      .transaction(() =>
        Effect.gen(function* () {
          const activeConnection = yield* activeConnectionForInstallation(
            webhook.installationId
          );
          const inboxId = yield* GitHubWebhookDeliveryId.generate;
          const inserted = yield* db
            .insert(schema.githubWebhookDeliveryTable)
            .values({
              id: inboxId,
              connectionId: activeConnection.id,
              deliveryId: webhook.deliveryId,
              eventName: webhook.eventName,
            })
            .onConflictDoNothing()
            .returning({ id: schema.githubWebhookDeliveryTable.id })
            .pipe(Effect.mapError(inboundDatabaseError("inbox record")));
          if (inserted.length === 0) {
            return;
          }
          const links = yield* db
            .select({
              externalResourceId: schema.integrationExternalResourceTable.id,
              postId: schema.postExternalResourceLinkTable.postId,
            })
            .from(schema.integrationExternalResourceTable)
            .innerJoin(
              schema.postExternalResourceLinkTable,
              eq(
                schema.postExternalResourceLinkTable.externalResourceId,
                schema.integrationExternalResourceTable.id
              )
            )
            .where(
              and(
                eq(
                  schema.integrationExternalResourceTable.connectionId,
                  activeConnection.id
                ),
                eq(
                  schema.integrationExternalResourceTable.resourceType,
                  gitHubIssueResourceType
                ),
                ...gitHubIssueSafeMetadataConditions({
                  issueNumber: webhook.issueNumber,
                  repositoryName: webhook.repositoryName,
                  repositoryOwner: webhook.repositoryOwner,
                })
              )
            )
            .pipe(Effect.mapError(inboundDatabaseError("issue link lookup")));
          for (const link of links) {
            yield* db
              .update(schema.integrationExternalResourceTable)
              .set({ stateKey: webhook.issueState })
              .where(
                eq(
                  schema.integrationExternalResourceTable.id,
                  link.externalResourceId
                )
              )
              .pipe(
                Effect.mapError(inboundDatabaseError("issue state update"))
              );
            const allLinks = yield* db
              .select({
                stateKey: schema.integrationExternalResourceTable.stateKey,
              })
              .from(schema.postExternalResourceLinkTable)
              .innerJoin(
                schema.integrationExternalResourceTable,
                eq(
                  schema.postExternalResourceLinkTable.externalResourceId,
                  schema.integrationExternalResourceTable.id
                )
              )
              .where(
                and(
                  eq(
                    schema.integrationExternalResourceTable.connectionId,
                    activeConnection.id
                  ),
                  eq(
                    schema.postExternalResourceLinkTable.postId,
                    link.postId
                  ),
                  eq(
                    schema.integrationExternalResourceTable.resourceType,
                    gitHubIssueResourceType
                  )
                )
              )
              .pipe(
                Effect.mapError(
                  inboundDatabaseError("linked issue aggregation")
                )
              );
            const rules = yield* db
              .select()
              .from(schema.githubSyncRuleTable)
              .where(
                and(
                  eq(
                    schema.githubSyncRuleTable.connectionId,
                    activeConnection.id
                  ),
                  eq(schema.githubSyncRuleTable.enabled, true)
                )
              )
              .orderBy(
                asc(schema.githubSyncRuleTable.createdAt),
                asc(schema.githubSyncRuleTable.id)
              )
              .pipe(
                Effect.mapError(
                  inboundDatabaseError("synchronization rule lookup")
                )
              );
            const matches = findMatchingGitHubSyncRules(
              rules.map((rule) => ({
                id: asLegid(GitHubSyncRuleId)(rule.id),
                connectionId: asLegid(IntegrationConnectionId)(
                  rule.connectionId
                ),
                issueMatchMode: rule.issueMatchMode,
                issueState: rule.issueState,
                postStatusId: asLegid(PostStatusId)(rule.postStatusId),
                upvoterNotificationPolicy: rule.upvoterNotificationPolicy,
                enabled: rule.enabled,
              })),
              allLinks.flatMap((item) =>
                item.stateKey === "open" || item.stateKey === "closed"
                  ? [item.stateKey]
                  : []
              )
            );
            const match = matches[0];
            if (match === undefined) {
              continue;
            }
            const post = yield* db
              .select({
                boardId: schema.postTable.boardId,
                slug: schema.postTable.slug,
                statusId: schema.postTable.statusId,
                title: schema.postTable.title,
              })
              .from(schema.postTable)
              .where(
                and(
                  eq(schema.postTable.id, link.postId),
                  eq(
                    schema.postTable.organizationId,
                    activeConnection.organizationId
                  )
                )
              )
              .limit(1)
              .pipe(Effect.mapError(inboundDatabaseError("post lookup")));
            if (
              post[0] === undefined ||
              post[0].statusId === match.postStatusId
            ) {
              continue;
            }
            yield* db
              .update(schema.postTable)
              .set({ statusId: match.postStatusId })
              .where(eq(schema.postTable.id, link.postId))
              .pipe(
                Effect.mapError(inboundDatabaseError("post status update"))
              );
            yield* recordPostIntegrationEvent({
              actor: { kind: "end_user" },
              boardId: asLegid(BoardId)(post[0].boardId),
              eventType: "feedback.post.status_changed",
              organizationId: asLegid(WorkspaceId)(
                activeConnection.organizationId
              ),
              postId: asLegid(PostId)(link.postId),
              postSlug: post[0].slug,
              previousStatusId: asLegid(PostStatusId)(post[0].statusId),
              statusId: match.postStatusId,
              title: post[0].title,
            }).pipe(
              Effect.provideService(
                IntegrationEventRecorder,
                integrationEventRecorder
              ),
              Effect.provideService(EmailOutboxConfig, emailOutboxConfig),
              Effect.provideService(PostRepository, postRepository),
              Effect.provideService(Database.Database, db),
              Effect.mapError(inboundDatabaseError("status event recording"))
            );
            if (match.upvoterNotificationPolicy === "notify_upvoters") {
              yield* notifications
                .notifyPostStatusChangedUpvoters({
                  organizationId: activeConnection.organizationId,
                  postId: link.postId,
                  deduplicationKey: `github.issue.status:${webhook.deliveryId}:${link.postId}:${match.id}`,
                })
                .pipe(
                  Effect.mapError(
                    inboundDatabaseError("upvoter notification")
                  )
                );
            }
          }
        })
      )
      .pipe(
        Effect.mapError((error) =>
          Schema.is(NotFoundError)(error)
            ? error
            : inboundDatabaseError("transaction")()
        )
      );

  const applyLifecycle = (webhook: GitHubInstallationLifecycleWebhook) =>
    db
      .transaction(() =>
        Effect.gen(function* () {
          const installations = yield* db
            .select({
              connectionId: schema.githubInstallationTable.connectionId,
              lifecycle: schema.integrationConnectionTable.lifecycle,
              suspendedAt: schema.githubInstallationTable.suspendedAt,
            })
            .from(schema.githubInstallationTable)
            .innerJoin(
              schema.integrationConnectionTable,
              eq(
                schema.integrationConnectionTable.id,
                schema.githubInstallationTable.connectionId
              )
            )
            .where(
              and(
                eq(
                  schema.githubInstallationTable.installationId,
                  webhook.installationId
                ),
                eq(
                  schema.integrationConnectionTable.provider,
                  IntegrationProviderKey.make("github")
                )
              )
            )
            .limit(1)
            .pipe(
              Effect.mapError(
                inboundDatabaseError("installation lifecycle lookup")
              )
            );
          const installation = installations[0];
          if (installation === undefined) {
            return;
          }
          const inboxId = yield* GitHubWebhookDeliveryId.generate;
          const inserted = yield* db
            .insert(schema.githubWebhookDeliveryTable)
            .values({
              id: inboxId,
              connectionId: installation.connectionId,
              deliveryId: webhook.deliveryId,
              eventName: "installation",
            })
            .onConflictDoNothing()
            .returning({ id: schema.githubWebhookDeliveryTable.id })
            .pipe(
              Effect.mapError(inboundDatabaseError("lifecycle inbox record"))
            );
          if (inserted.length === 0) {
            return;
          }
          if (webhook.action === "deleted") {
            yield* db
              .update(schema.integrationConnectionTable)
              .set({ lifecycle: "archived", archivedAt: new Date() })
              .where(
                eq(
                  schema.integrationConnectionTable.id,
                  installation.connectionId
                )
              )
              .pipe(
                Effect.mapError(inboundDatabaseError("installation archive"))
              );
            return;
          }
          if (webhook.action === "suspend") {
            yield* db
              .update(schema.githubInstallationTable)
              .set({ suspendedAt: new Date() })
              .where(
                eq(
                  schema.githubInstallationTable.connectionId,
                  installation.connectionId
                )
              )
              .pipe(
                Effect.mapError(
                  inboundDatabaseError("installation suspension")
                )
              );
            yield* db
              .update(schema.integrationConnectionTable)
              .set({ lifecycle: "paused" })
              .where(
                eq(
                  schema.integrationConnectionTable.id,
                  installation.connectionId
                )
              )
              .pipe(
                Effect.mapError(inboundDatabaseError("connection pause"))
              );
            return;
          }
          if (webhook.action !== "unsuspend") {
            return;
          }
          yield* db
            .update(schema.githubInstallationTable)
            .set({ suspendedAt: null })
            .where(
              eq(
                schema.githubInstallationTable.connectionId,
                installation.connectionId
              )
            )
            .pipe(
              Effect.mapError(
                inboundDatabaseError("installation restoration")
              )
            );
          if (
            installation.lifecycle === "paused" &&
            installation.suspendedAt !== null
          ) {
            yield* db
              .update(schema.integrationConnectionTable)
              .set({ lifecycle: "active" })
              .where(
                eq(
                  schema.integrationConnectionTable.id,
                  installation.connectionId
                )
              )
              .pipe(
                Effect.mapError(
                  inboundDatabaseError("connection restoration")
                )
              );
          }
        })
      )
      .pipe(
        Effect.mapError((error) =>
          Schema.is(NotFoundError)(error)
            ? error
            : inboundDatabaseError("installation lifecycle transaction")()
        )
      );

  return GitHubInboundService.of({
    applyWebhook: (webhook) => {
      switch (webhook.kind) {
        case "issue": {
          const payload = webhook.payload;
          if (
            payload.action !== "opened" &&
            payload.action !== "reopened" &&
            payload.action !== "closed"
          ) {
            return Effect.void;
          }
          return applyIssue({
            deliveryId: webhook.deliveryId,
            eventName: "issues",
            installationId: String(payload.installation.id),
            issueNumber: payload.issue.number,
            issueState: payload.issue.state,
            repositoryName: payload.repository.name,
            repositoryOwner: payload.repository.owner.login,
          });
        }
        case "installation": {
          const action = webhook.payload.action;
          if (
            action === "deleted" ||
            action === "suspend" ||
            action === "unsuspend"
          ) {
            return applyLifecycle({
              action,
              deliveryId: webhook.deliveryId,
              installationId: String(webhook.payload.installation.id),
            });
          }
          return Effect.void;
        }
        case "installation_repositories":
          // Settings validate repository availability on update; this event is
          // acknowledged so GitHub does not retry a delivery with no mutation.
          return Effect.void;
      }
    },
    applyIssueWebhook: applyIssue,
    applyInstallationLifecycleWebhook: applyLifecycle,
  });
});

/** Live inbound service layer requiring the database and optional notification service. */
export const GitHubInboundServiceLive = Layer.effect(
  GitHubInboundService,
  makeGitHubInboundService
);
