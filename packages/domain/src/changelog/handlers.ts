import { transaction } from "@feeblo/db";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { sanitizeMarkdown } from "@feeblo/utils/markdown-sanitizer";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  cleanupOrphanedEditorAssets,
  cleanupPreparedEditorAssets,
  commitPreparedEditorAssets,
  prepareEditorAssetContent,
  rollbackPreparedEditorAssets,
  syncChangelogAssetReferences,
} from "../asset/service";
import { EmailOutboxRepository } from "../email-outbox/repository";
import { wakeEmailOutboxBestEffort } from "../email-outbox/workflow";
import { EntitlementPolicy } from "../entitlement/policies";
import { NotificationService } from "../notification/service";
import * as Policy from "../policy";
import * as RateLimit from "../rate-limit";
import { InternalServerError, withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { ChangelogNotFoundError } from "./errors";
import { ChangelogPolicy } from "./policies";
import { ChangelogRepository } from "./repository";
import { ChangelogRpcs } from "./rpcs";
import type {
  TChangelogCreate,
  TChangelogDelete,
  TChangelogGet,
  TChangelogList,
  TChangelogSendUpdate,
  TChangelogUpdate,
} from "./schema";

export const ChangelogRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* ChangelogRepository;
  const emailOutbox = yield* EmailOutboxRepository;
  const entitlementPolicy = yield* EntitlementPolicy;
  const changelogPolicy = yield* ChangelogPolicy;
  const sitePolicy = yield* SitePolicy;
  const notifications = yield* Effect.serviceOption(NotificationService);

  /** In-app notification for subscribed members; email stays outbox-driven. */
  const notifyChangelogPublished = (args: {
    readonly actorUserId?: string | null;
    readonly changelogId: string;
    readonly changelogSlug: string;
    readonly organizationId: string;
    readonly title: string;
  }) =>
    Option.match(notifications, {
      onNone: () => Effect.void,
      onSome: (service) => service.notifyChangelogPublished(args),
    });

  const recordChangelogPublishedIntent = Effect.fn(
    "Changelog.recordPublishedEmailIntent"
  )(function* (args: {
    readonly changelogId: string;
    readonly organizationId: string;
  }) {
    const mayMaterialize = yield* entitlementPolicy.mayMaterializeEmailIntent({
      organizationId: args.organizationId,
      kind: "changelog.published",
    });
    if (!mayMaterialize) {
      return;
    }

    const now = yield* DateTime.nowAsDate;
    const result = yield* emailOutbox
      .recordIntent({
        aggregateId: args.changelogId,
        aggregateType: "changelog",
        deduplicationKey: `changelog.published:${args.changelogId}`,
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        kind: "changelog.published",
        organizationId: args.organizationId,
        payload: {
          kind: "changelog.published",
          changelogId: args.changelogId,
        },
        scheduledAt: now,
      })
      .pipe(
        Effect.tapError((error) =>
          Effect.logError(
            "Failed to record changelog publication email intent",
            error
          ).pipe(
            Effect.annotateLogs({
              changelogId: args.changelogId,
              organizationId: args.organizationId,
            })
          )
        ),
        Effect.mapError(
          () =>
            new InternalServerError({
              message: "Failed to record changelog publication email intent",
            })
        )
      );
    return result._tag === "Inserted" ? result.intent.id : undefined;
  });

  return {
    ChangelogList: (args: TChangelogList) =>
      repository
        .findMany(args)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Changelog", "select")
        ),

    ChangelogListPublic: (args: TChangelogList) =>
      repository.findManyPublished(args).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "ChangelogListPublic",
          level: "read",
        }),
        Policy.withPublicPolicy(
          sitePolicy.canViewChangelog(args.organizationId)
        ),
        withRemapDbErrors("Changelog", "select")
      ),

    ChangelogGetPublic: (args: TChangelogGet) =>
      Effect.gen(function* () {
        const entry = yield* repository.findPublishedBySlug(args);
        if (entry === undefined) {
          return yield* new ChangelogNotFoundError({
            message: "Changelog entry not found",
          });
        }
        return entry;
      }).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "ChangelogGetPublic",
          level: "read",
        }),
        Policy.withPublicPolicy(
          sitePolicy.canViewChangelog(args.organizationId)
        ),
        withRemapDbErrors("Changelog", "select")
      ),

    ChangelogCreate: (args: TChangelogCreate) => {
      const { sanitizedMarkdown, sanitizedHtml } = sanitizeMarkdown(
        args.content
      );
      return Effect.gen(function* () {
        const session = yield* CurrentSession;
        const prepared = yield* prepareEditorAssetContent({
          organizationId: args.organizationId,
          userId: session.session.userId,
          content: sanitizedMarkdown,
          assetIds: args.assetIds,
          coverImageUrl: args.coverImage,
        });
        const isMember = Policy.getMembership(session, args.organizationId);

        const outboxId = yield* transaction(
          Effect.gen(function* () {
            yield* repository.create({
              ...args,
              content: prepared.content,
              coverImage: prepared.coverImage,
              creatorId: session.session.userId,
              ...(isMember && { creatorMemberId: isMember.membershipId }),
              excerpt: htmlToExcerpt(sanitizedHtml),
            });
            const createdOutboxId =
              args.status === "published"
                ? yield* recordChangelogPublishedIntent({
                    changelogId: args.id,
                    organizationId: args.organizationId,
                  })
                : undefined;
            if (args.status === "published") {
              yield* notifyChangelogPublished({
                ...(isMember && { actorUserId: session.session.userId }),
                changelogId: args.id,
                changelogSlug: args.slug,
                organizationId: args.organizationId,
                title: args.title,
              });
            }
            yield* commitPreparedEditorAssets(prepared.promotions);
            yield* syncChangelogAssetReferences({
              changelogId: args.id,
              organizationId: args.organizationId,
              userId: session.session.userId,
              content: prepared.content,
              assetIds: args.assetIds,
              coverImageUrl: prepared.coverImage,
            });
            return createdOutboxId;
          })
        ).pipe(
          Effect.tapCause(() =>
            rollbackPreparedEditorAssets(prepared.promotions)
          ),
          Effect.ensuring(cleanupPreparedEditorAssets(prepared.promotions))
        );
        yield* wakeEmailOutboxBestEffort(outboxId, args.organizationId);
      }).pipe(
        Policy.withPolicy(changelogPolicy.canCreate(args.organizationId)),
        withRemapDbErrors("Changelog", "create")
      );
    },

    ChangelogDelete: (args: TChangelogDelete) =>
      repository.delete(args).pipe(
        Effect.tap(() =>
          cleanupOrphanedEditorAssets({
            organizationId: args.organizationId,
          }).pipe(
            Effect.catch((cause) =>
              Effect.logWarning(
                "Failed to clean up orphaned editor assets",
                cause
              ).pipe(
                Effect.annotateLogs({ organizationId: args.organizationId })
              )
            )
          )
        ),
        Policy.withPolicy(
          changelogPolicy.canDelete({
            organizationId: args.organizationId,
            changelogId: args.id,
          })
        ),
        withRemapDbErrors("Changelog", "delete")
      ),

    ChangelogUpdate: (args: TChangelogUpdate) => {
      const { sanitizedMarkdown, sanitizedHtml } = sanitizeMarkdown(
        args.content
      );
      return Effect.gen(function* () {
        const session = yield* CurrentSession;
        const membership = Policy.getMembership(session, args.organizationId);
        const prepared = yield* prepareEditorAssetContent({
          organizationId: args.organizationId,
          userId: session.session.userId,
          content: sanitizedMarkdown,
          assetIds: args.assetIds,
          coverImageUrl: args.coverImage,
        });

        const outboxId = yield* transaction(
          Effect.gen(function* () {
            const previousStatus = yield* repository.findStatus({
              id: args.id,
              organizationId: args.organizationId,
            });
            yield* repository.update({
              ...args,
              content: prepared.content,
              coverImage: prepared.coverImage,
              excerpt: htmlToExcerpt(sanitizedHtml),
            });
            const publishedNow =
              previousStatus !== "published" && args.status === "published";
            const createdOutboxId = publishedNow
              ? yield* recordChangelogPublishedIntent({
                  changelogId: args.id,
                  organizationId: args.organizationId,
                })
              : undefined;
            if (publishedNow) {
              yield* notifyChangelogPublished({
                ...(membership && { actorUserId: session.session.userId }),
                changelogId: args.id,
                changelogSlug: args.slug,
                organizationId: args.organizationId,
                title: args.title,
              });
            }
            yield* commitPreparedEditorAssets(prepared.promotions);
            yield* syncChangelogAssetReferences({
              changelogId: args.id,
              organizationId: args.organizationId,
              userId: session.session.userId,
              content: prepared.content,
              assetIds: args.assetIds,
              coverImageUrl: prepared.coverImage,
            });
            return createdOutboxId;
          })
        ).pipe(
          Effect.tapCause(() =>
            rollbackPreparedEditorAssets(prepared.promotions)
          ),
          Effect.ensuring(cleanupPreparedEditorAssets(prepared.promotions))
        );
        yield* wakeEmailOutboxBestEffort(outboxId, args.organizationId);
      }).pipe(
        Policy.withPolicy(
          changelogPolicy.canUpdate({
            organizationId: args.organizationId,
            changelogId: args.id,
          })
        ),
        withRemapDbErrors("Changelog", "update")
      );
    },

    ChangelogSendUpdate: (args: TChangelogSendUpdate) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const membership = Policy.getMembership(session, args.organizationId);
        const outboxId = yield* transaction(
          Effect.gen(function* () {
            const status = yield* repository.findStatus({
              id: args.id,
              organizationId: args.organizationId,
            });
            if (status !== "published") {
              return yield* new Policy.PolicyDeniedError({
                reason: "Only published changelog entries can send updates.",
              });
            }

            const mayMaterialize =
              yield* entitlementPolicy.mayMaterializeEmailIntent({
                organizationId: args.organizationId,
                kind: "changelog.update_requested",
              });
            if (!mayMaterialize) {
              return yield* new Policy.PolicyDeniedError({
                reason: "Changelog subscriber emails require a paid plan.",
              });
            }

            const now = yield* DateTime.nowAsDate;
            const result = yield* emailOutbox
              .recordIntent({
                aggregateId: args.id,
                aggregateType: "changelog",
                deduplicationKey: `changelog.update_requested:${args.id}:${args.requestId}`,
                expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
                kind: "changelog.update_requested",
                organizationId: args.organizationId,
                payload: {
                  kind: "changelog.update_requested",
                  changelogId: args.id,
                },
                scheduledAt: now,
              })
              .pipe(
                Effect.tapError((error) =>
                  Effect.logError(
                    "Failed to record changelog update email intent",
                    error
                  ).pipe(
                    Effect.annotateLogs({
                      changelogId: args.id,
                      organizationId: args.organizationId,
                    })
                  )
                ),
                Effect.mapError(
                  () =>
                    new InternalServerError({
                      message: "Failed to record changelog update email intent",
                    })
                )
              );
            // Subscribers with email suppressed still see the update in-app;
            // deduplicated per request so retries stay silent.
            if (result._tag === "Inserted") {
              const context = yield* repository.findNotificationContext({
                id: args.id,
                organizationId: args.organizationId,
              });
              if (context) {
                yield* Option.match(notifications, {
                  onNone: () => Effect.void,
                  onSome: (service) =>
                    service.notifyChangelogUpdated({
                      ...(membership && {
                        actorUserId: session.session.userId,
                      }),
                      changelogId: args.id,
                      changelogSlug: context.slug,
                      organizationId: args.organizationId,
                      requestId: args.requestId,
                      title: context.title,
                    }),
                });
              }
            }
            return result._tag === "Inserted" ? result.intent.id : undefined;
          })
        );
        yield* wakeEmailOutboxBestEffort(outboxId, args.organizationId);
      }).pipe(
        Policy.withPolicy(
          changelogPolicy.canUpdate({
            organizationId: args.organizationId,
            changelogId: args.id,
          })
        ),
        withRemapDbErrors("Changelog", "update")
      ),
  };
});

export const ChangelogRpcHandlers = ChangelogRpcs.toLayer(
  ChangelogRpcHandlersEffect
).pipe(
  Layer.provide(SitePolicy.layer),
  Layer.provide(EntitlementPolicy.layer),
  Layer.provide(ChangelogPolicy.layer),
  Layer.provide(WorkspaceRepository.layer),
  Layer.provide(SiteRepository.layer),
  Layer.provide(ChangelogRepository.layer),
  Layer.provide(EmailOutboxRepository.layer),
  Layer.provide(NotificationService.layer)
);
