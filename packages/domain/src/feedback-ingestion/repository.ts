import { currentDb, schema } from "@feeblo/db";
import {
  asLegid,
  BoardId,
  ContactId,
  ContactIdentityLinkId,
  FeedbackChannelId,
  FeedbackReceiptId,
  FeedbackTriageItemId,
  PostId,
  WorkspaceId,
} from "@feeblo/id";
import { and, asc, eq, gt, ilike, isNull, or, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  FeedbackChannelDisabledError,
  FeedbackNotFoundError,
  FeedbackTriageAlreadyDecidedError,
} from "./errors";
import type { FeedbackAssessment } from "./interpreter";
import type {
  TCaptureFeedback,
  TFeedbackChannelKind,
  TFeedbackSimilarityQuery,
  TFeedbackTriageList,
} from "./schema";

const toFeedbackReceiptId = asLegid(FeedbackReceiptId);
const toFeedbackTriageItemId = asLegid(FeedbackTriageItemId);
const toBoardId = asLegid(BoardId);
const toPostId = asLegid(PostId);
const toWorkspaceId = asLegid(WorkspaceId);

const normalizeEmail = (email: string | undefined) =>
  email?.trim().toLowerCase() || undefined;

const similarityTokens = (value: string) =>
  Array.from(
    new Set(
      value
        .toLowerCase()
        .replaceAll(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 3)
    )
  ).slice(0, 8);

const contactSourceFor = (
  source: TFeedbackChannelKind
): "DASHBOARD" | "WIDGET" | "API" | "IMPORT" => {
  switch (source) {
    case "DASHBOARD":
      return "DASHBOARD";
    case "WIDGET":
    case "PUBLIC_PORTAL":
      return "WIDGET";
    case "CSV_IMPORT":
      return "IMPORT";
    default:
      return "API";
  }
};

const makeFeedbackIngestionRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  const findContact = ({
    organizationId,
    email,
  }: {
    organizationId: string;
    email: string | undefined;
  }) => {
    if (!email) {
      return Effect.void;
    }
    return db
      .select({ id: schema.contactTable.id })
      .from(schema.contactTable)
      .where(
        and(
          eq(schema.contactTable.organizationId, organizationId),
          eq(schema.contactTable.email, email)
        )
      )
      .limit(1)
      .pipe(Effect.map((rows) => rows[0]));
  };

  return {
    findSimilarPosts: (input: TFeedbackSimilarityQuery) =>
      Effect.gen(function* () {
        const tokens = similarityTokens(
          `${input.title} ${input.text ?? ""}`
        );
        if (tokens.length === 0) {
          return [];
        }
        const rows = yield* db
          .select({
            postId: schema.postTable.id,
            boardId: schema.postTable.boardId,
            title: schema.postTable.title,
            excerpt: schema.postTable.excerpt,
            slug: schema.postTable.slug,
          })
          .from(schema.postTable)
          .innerJoin(
            schema.boardTable,
            eq(schema.boardTable.id, schema.postTable.boardId)
          )
          .where(
            and(
              eq(schema.postTable.organizationId, input.organizationId),
              eq(schema.boardTable.visibility, "PUBLIC"),
              ...(input.boardId
                ? [eq(schema.postTable.boardId, input.boardId)]
                : []),
              or(
                ...tokens.flatMap((token) => [
                  ilike(schema.postTable.title, `%${token}%`),
                  ilike(schema.postTable.excerpt, `%${token}%`),
                ])
              )
            )
          )
          .limit(25);

        return rows
          .map((row) => {
            const title = row.title.toLowerCase();
            const body = row.excerpt.toLowerCase();
            const matchedTitle = tokens.filter((token) =>
              title.includes(token)
            ).length;
            const matchedBody = tokens.filter((token) =>
              body.includes(token)
            ).length;
            return {
              ...row,
              boardId: toBoardId(row.boardId),
              postId: toPostId(row.postId),
              score:
                (matchedTitle * 2 + matchedBody) /
                Math.max(tokens.length * 2, 1),
            };
          })
          .filter(({ score }) => score >= 0.25)
          .sort((left, right) => right.score - left.score)
          .slice(0, 5);
      }),

    captureIdempotently: (
      input: TCaptureFeedback,
      options: { readonly attachedPostId?: string } = {}
    ) =>
      Effect.gen(function* () {
        const now = new Date();
        const generatedChannelId = yield* FeedbackChannelId.generate;
        const [createdChannel] = yield* db
          .insert(schema.feedbackChannelTable)
          .values({
            id: generatedChannelId,
            organizationId: input.organizationId,
            key: input.channel.key,
            label: input.channel.label,
            kind: input.channel.kind,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing({
            target: [
              schema.feedbackChannelTable.organizationId,
              schema.feedbackChannelTable.key,
            ],
          })
          .returning({
            enabled: schema.feedbackChannelTable.enabled,
            id: schema.feedbackChannelTable.id,
          });

        const channel =
          createdChannel ??
          (yield* db
            .select({
              enabled: schema.feedbackChannelTable.enabled,
              id: schema.feedbackChannelTable.id,
            })
            .from(schema.feedbackChannelTable)
            .where(
              and(
                eq(
                  schema.feedbackChannelTable.organizationId,
                  input.organizationId
                ),
                eq(schema.feedbackChannelTable.key, input.channel.key)
              )
            )
            .limit(1)
            .pipe(Effect.map((rows) => rows[0])));

        if (!channel) {
          return yield* new FeedbackNotFoundError({
            message: "Feedback channel could not be created",
          });
        }
        if (!channel.enabled) {
          return yield* new FeedbackChannelDisabledError({
            channelKey: input.channel.key,
          });
        }

        const generatedFeedbackReceiptId = yield* FeedbackReceiptId.generate;
        const [created] = yield* db
          .insert(schema.feedbackReceiptTable)
          .values({
            id: generatedFeedbackReceiptId,
            organizationId: input.organizationId,
            channelId: channel.id,
            ...(input.upstreamItemId !== undefined && {
              upstreamItemId: input.upstreamItemId,
            }),
            deliveryKey: input.deliveryKey,
            sender: input.sender,
            message: input.message,
            metadata: input.metadata ?? {},
            ...(options.attachedPostId
              ? {
                  attachedPostId: options.attachedPostId,
                  pipelineStage: "READY" as const,
                }
              : {}),
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing({
            target: [
              schema.feedbackReceiptTable.organizationId,
              schema.feedbackReceiptTable.channelId,
              schema.feedbackReceiptTable.deliveryKey,
            ],
          })
          .returning({ id: schema.feedbackReceiptTable.id });

        if (created) {
          if (!options.attachedPostId) {
            yield* db.insert(schema.feedbackIngestionOutboxTable).values({
              receiptId: created.id,
              organizationId: input.organizationId,
              createdAt: now,
            });
          }
          return {
            status: "CREATED",
            receiptId: toFeedbackReceiptId(created.id),
          } as const;
        }

        const existing = yield* db
          .select({ id: schema.feedbackReceiptTable.id })
          .from(schema.feedbackReceiptTable)
          .where(
            and(
              eq(
                schema.feedbackReceiptTable.organizationId,
                input.organizationId
              ),
              eq(schema.feedbackReceiptTable.channelId, channel.id),
              eq(schema.feedbackReceiptTable.deliveryKey, input.deliveryKey)
            )
          )
          .limit(1)
          .pipe(Effect.map((rows) => rows[0]));

        if (!existing) {
          return yield* new FeedbackNotFoundError({
            message: "Captured feedback could not be loaded",
          });
        }

        return {
          status: "DUPLICATE",
          receiptId: toFeedbackReceiptId(existing.id),
        } as const;
      }),

    listPendingWorkflowDispatches: ({ limit }: { readonly limit: number }) =>
      db
        .select({
          organizationId:
            schema.feedbackIngestionOutboxTable.organizationId,
          receiptId: schema.feedbackIngestionOutboxTable.receiptId,
        })
        .from(schema.feedbackIngestionOutboxTable)
        .where(isNull(schema.feedbackIngestionOutboxTable.scheduledAt))
        .orderBy(asc(schema.feedbackIngestionOutboxTable.createdAt))
        .limit(limit)
        .for("update", { skipLocked: true }),

    recordWorkflowDispatchAttempt: ({
      receiptId,
      result,
    }:
      | {
          readonly receiptId: string;
          readonly result: "succeeded";
        }
      | {
          readonly receiptId: string;
          readonly result: "failed";
        }
    ) =>
      db
        .update(schema.feedbackIngestionOutboxTable)
        .set({
          attemptCount: sql`${schema.feedbackIngestionOutboxTable.attemptCount} + 1`,
          lastAttemptAt: new Date(),
          ...(result === "succeeded" ? { scheduledAt: new Date() } : {}),
        })
        .where(eq(schema.feedbackIngestionOutboxTable.receiptId, receiptId))
        .pipe(Effect.asVoid),

    getForProcessing: ({
      organizationId,
      receiptId,
    }: {
      organizationId: string;
      receiptId: string;
    }) =>
      db
        .select({
          sender: schema.feedbackReceiptTable.sender,
          message: schema.feedbackReceiptTable.message,
          metadata: schema.feedbackReceiptTable.metadata,
        })
        .from(schema.feedbackReceiptTable)
        .where(
          and(
            eq(schema.feedbackReceiptTable.id, receiptId),
            eq(schema.feedbackReceiptTable.organizationId, organizationId)
          )
        )
        .limit(1)
        .pipe(
          Effect.map((rows) => rows[0]),
          Effect.flatMap((raw) =>
            raw
              ? Effect.succeed(raw)
              : Effect.fail(
                  new FeedbackNotFoundError({
                    message: "Raw feedback not found",
                  })
                )
          )
        ),

    resolveIdentity: ({
      organizationId,
      receiptId,
    }: {
      organizationId: string;
      receiptId: string;
    }) =>
      Effect.gen(function* () {
        const raw = yield* db
          .select({
            sender: schema.feedbackReceiptTable.sender,
            contactId: schema.feedbackReceiptTable.contactId,
            channelId: schema.feedbackReceiptTable.channelId,
            channelKind: schema.feedbackChannelTable.kind,
          })
          .from(schema.feedbackReceiptTable)
          .innerJoin(
            schema.feedbackChannelTable,
            eq(
              schema.feedbackChannelTable.id,
              schema.feedbackReceiptTable.channelId
            )
          )
          .where(
            and(
              eq(schema.feedbackReceiptTable.id, receiptId),
              eq(schema.feedbackReceiptTable.organizationId, organizationId)
            )
          )
          .limit(1)
          .pipe(Effect.map((rows) => rows[0]));

        if (!raw) {
          return yield* new FeedbackNotFoundError({
            message: "Raw feedback not found",
          });
        }

        if (raw.contactId) {
          return raw.contactId;
        }

        const upstreamContactId = raw.sender.upstreamId;
        const email = normalizeEmail(raw.sender.email);
        const mapped = upstreamContactId
          ? yield* db
              .select({
                contactId: schema.contactIdentityLinkTable.contactId,
              })
              .from(schema.contactIdentityLinkTable)
              .where(
                and(
                  eq(
                    schema.contactIdentityLinkTable.organizationId,
                    organizationId
                  ),
                  eq(schema.contactIdentityLinkTable.channelId, raw.channelId),
                  eq(
                    schema.contactIdentityLinkTable.upstreamContactId,
                    upstreamContactId
                  )
                )
              )
              .limit(1)
              .pipe(Effect.map((rows) => rows[0]))
          : undefined;

        let contactId = mapped?.contactId;

        if (!contactId) {
          const existing = yield* findContact({
            organizationId,
            email,
          });
          contactId = existing?.id;
        }

        if (!(contactId || upstreamContactId || email)) {
          yield* db
            .update(schema.feedbackReceiptTable)
            .set({
              pipelineStage: "IDENTIFIED",
              updatedAt: new Date(),
            })
            .where(eq(schema.feedbackReceiptTable.id, receiptId));
          return null;
        }

        let createdContactId: string | undefined;
        if (!contactId) {
          const generatedContactId = yield* ContactId.generate;
          const now = new Date();
          const [created] = yield* db
            .insert(schema.contactTable)
            .values({
              id: generatedContactId,
              organizationId,
              email,
              name: raw.sender.name,
              source: contactSourceFor(raw.channelKind),
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing()
            .returning({ id: schema.contactTable.id });

          contactId =
            created?.id ??
            (yield* findContact({
              organizationId,
              email,
            }))?.id;
          createdContactId = created?.id;
        }

        if (!contactId) {
          return yield* new FeedbackNotFoundError({
            message: "Feedback contact could not be resolved",
          });
        }

        if (upstreamContactId) {
          const mappingId = yield* ContactIdentityLinkId.generate;
          const [createdMapping] = yield* db
            .insert(schema.contactIdentityLinkTable)
            .values({
              id: mappingId,
              organizationId,
              channelId: raw.channelId,
              upstreamContactId,
              contactId,
            })
            .onConflictDoNothing()
            .returning({
              contactId: schema.contactIdentityLinkTable.contactId,
            });

          if (!createdMapping) {
            const canonicalMapping = yield* db
              .select({
                contactId: schema.contactIdentityLinkTable.contactId,
              })
              .from(schema.contactIdentityLinkTable)
              .where(
                and(
                  eq(
                    schema.contactIdentityLinkTable.organizationId,
                    organizationId
                  ),
                  eq(schema.contactIdentityLinkTable.channelId, raw.channelId),
                  eq(
                    schema.contactIdentityLinkTable.upstreamContactId,
                    upstreamContactId
                  )
                )
              )
              .limit(1)
              .pipe(Effect.map((rows) => rows[0]));

            if (canonicalMapping) {
              if (
                createdContactId &&
                createdContactId !== canonicalMapping.contactId
              ) {
                yield* db
                  .delete(schema.contactTable)
                  .where(eq(schema.contactTable.id, createdContactId));
              }
              contactId = canonicalMapping.contactId;
            }
          }
        }

        yield* db
          .update(schema.feedbackReceiptTable)
          .set({
            contactId,
            pipelineStage: "IDENTIFIED",
            updatedAt: new Date(),
          })
          .where(eq(schema.feedbackReceiptTable.id, receiptId));

        return contactId;
      }),

    persistAssessment: ({
      organizationId,
      receiptId,
      assessment,
    }: {
      organizationId: string;
      receiptId: string;
      assessment: FeedbackAssessment;
    }) =>
      Effect.gen(function* () {
        const triageItemId = yield* FeedbackTriageItemId.generate;
        const now = new Date();
        yield* db
          .insert(schema.feedbackTriageItemTable)
          .values({
            id: triageItemId,
            organizationId,
            receiptId,
            action: assessment.proposal.action,
            digest: assessment.digest,
            excerpts: assessment.excerpts,
            customerNeed: assessment.customerNeed,
            tone: assessment.tone,
            priority: assessment.priority,
            interpretationConfidence: assessment.interpretationConfidence,
            proposedTitle: assessment.proposal.title,
            proposedBody: assessment.proposal.body,
            proposedBoardId: assessment.proposal.boardId,
            proposedPostId: assessment.proposal.postId,
            rationale: assessment.proposal.rationale,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing({
            target: schema.feedbackTriageItemTable.receiptId,
          });

        yield* db
          .update(schema.feedbackReceiptTable)
          .set({
            pipelineStage: "READY",
            failureDetail: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.feedbackReceiptTable.id, receiptId),
              eq(schema.feedbackReceiptTable.organizationId, organizationId)
            )
          );
      }),

    markProcessingFailed: ({
      organizationId,
      receiptId,
      message,
    }: {
      organizationId: string;
      receiptId: string;
      message: string;
    }) =>
      db
        .update(schema.feedbackReceiptTable)
        .set({
          pipelineStage: "FAILED",
          failureDetail: message,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.feedbackReceiptTable.id, receiptId),
            eq(schema.feedbackReceiptTable.organizationId, organizationId)
          )
        )
        .pipe(Effect.asVoid),

    listTriageItems: (input: TFeedbackTriageList) =>
      db
        .select({
          id: schema.feedbackTriageItemTable.id,
          organizationId: schema.feedbackTriageItemTable.organizationId,
          receiptId: schema.feedbackTriageItemTable.receiptId,
          action: schema.feedbackTriageItemTable.action,
          status: schema.feedbackTriageItemTable.status,
          channelKind: schema.feedbackChannelTable.kind,
          channelLabel: schema.feedbackChannelTable.label,
          sender: schema.feedbackReceiptTable.sender,
          contactId: schema.feedbackReceiptTable.contactId,
          digest: schema.feedbackTriageItemTable.digest,
          excerpts: schema.feedbackTriageItemTable.excerpts,
          customerNeed: schema.feedbackTriageItemTable.customerNeed,
          tone: schema.feedbackTriageItemTable.tone,
          priority: schema.feedbackTriageItemTable.priority,
          interpretationConfidence:
            schema.feedbackTriageItemTable.interpretationConfidence,
          proposedTitle: schema.feedbackTriageItemTable.proposedTitle,
          proposedBody: schema.feedbackTriageItemTable.proposedBody,
          proposedBoardId: schema.feedbackTriageItemTable.proposedBoardId,
          proposedPostId: schema.feedbackTriageItemTable.proposedPostId,
          rationale: schema.feedbackTriageItemTable.rationale,
          createdAt: schema.feedbackTriageItemTable.createdAt,
        })
        .from(schema.feedbackTriageItemTable)
        .innerJoin(
          schema.feedbackReceiptTable,
          eq(
            schema.feedbackReceiptTable.id,
            schema.feedbackTriageItemTable.receiptId
          )
        )
        .innerJoin(
          schema.feedbackChannelTable,
          eq(
            schema.feedbackChannelTable.id,
            schema.feedbackReceiptTable.channelId
          )
        )
        .where(
          and(
            eq(
              schema.feedbackTriageItemTable.organizationId,
              input.organizationId
            ),
            ...(input.status
              ? [eq(schema.feedbackTriageItemTable.status, input.status)]
              : []),
            ...(input.cursor
              ? [
                  or(
                    gt(
                      schema.feedbackTriageItemTable.createdAt,
                      input.cursor.createdAt
                    ),
                    and(
                      eq(
                        schema.feedbackTriageItemTable.createdAt,
                        input.cursor.createdAt
                      ),
                      gt(schema.feedbackTriageItemTable.id, input.cursor.id)
                    )
                  ),
                ]
              : [])
          )
        )
        .orderBy(
          asc(schema.feedbackTriageItemTable.createdAt),
          asc(schema.feedbackTriageItemTable.id)
        )
        .limit(input.pageSize + 1)
        .pipe(
          Effect.map((rows) => {
            const items = rows.slice(0, input.pageSize).map((row) => ({
              ...row,
              id: toFeedbackTriageItemId(row.id),
              organizationId: toWorkspaceId(row.organizationId),
              receiptId: toFeedbackReceiptId(row.receiptId),
              senderName: row.sender.name ?? null,
              senderEmail: row.sender.email ?? null,
            }));
            const lastItem = items.at(-1);
            return {
              items,
              nextCursor:
                rows.length > input.pageSize && lastItem
                  ? { createdAt: lastItem.createdAt, id: lastItem.id }
                  : null,
            };
          })
        ),

    getOpenTriageItemForUpdate: ({
      organizationId,
      triageItemId,
    }: {
      organizationId: string;
      triageItemId: string;
    }) =>
      Effect.gen(function* () {
        const triageItem = yield* db
          .select({
            id: schema.feedbackTriageItemTable.id,
            status: schema.feedbackTriageItemTable.status,
            proposedTitle: schema.feedbackTriageItemTable.proposedTitle,
            proposedBody: schema.feedbackTriageItemTable.proposedBody,
            contactId: schema.feedbackReceiptTable.contactId,
            channelKind: schema.feedbackChannelTable.kind,
            receiptId: schema.feedbackReceiptTable.id,
          })
          .from(schema.feedbackTriageItemTable)
          .innerJoin(
            schema.feedbackReceiptTable,
            eq(
              schema.feedbackReceiptTable.id,
              schema.feedbackTriageItemTable.receiptId
            )
          )
          .innerJoin(
            schema.feedbackChannelTable,
            eq(
              schema.feedbackChannelTable.id,
              schema.feedbackReceiptTable.channelId
            )
          )
          .where(
            and(
              eq(schema.feedbackTriageItemTable.id, triageItemId),
              eq(schema.feedbackTriageItemTable.organizationId, organizationId)
            )
          )
          .limit(1)
          .for("update", { of: schema.feedbackTriageItemTable })
          .pipe(Effect.map((rows) => rows[0]));

        if (!triageItem) {
          return yield* new FeedbackNotFoundError({
            message: "Feedback triage item not found",
          });
        }
        if (triageItem.status !== "OPEN") {
          return yield* new FeedbackTriageAlreadyDecidedError({
            triageItemId,
          });
        }
        return triageItem;
      }),

    validatePostTarget: ({
      organizationId,
      boardId,
      statusId,
    }: {
      organizationId: string;
      boardId: string;
      statusId: string;
    }) =>
      Effect.all({
        board: db
          .select({ id: schema.boardTable.id })
          .from(schema.boardTable)
          .where(
            and(
              eq(schema.boardTable.id, boardId),
              eq(schema.boardTable.organizationId, organizationId)
            )
          )
          .limit(1)
          .pipe(Effect.map((rows) => rows[0] !== undefined)),
        status: db
          .select({ id: schema.postStatusTable.id })
          .from(schema.postStatusTable)
          .where(
            and(
              eq(schema.postStatusTable.id, statusId),
              eq(schema.postStatusTable.organizationId, organizationId)
            )
          )
          .limit(1)
          .pipe(Effect.map((rows) => rows[0] !== undefined)),
      }).pipe(Effect.map(({ board, status }) => board && status)),

    isPostAttachable: ({
      organizationId,
      postId,
    }: {
      organizationId: string;
      postId: string;
    }) =>
      db
        .select({ id: schema.postTable.id })
        .from(schema.postTable)
        .where(
          and(
            eq(schema.postTable.id, postId),
            eq(schema.postTable.organizationId, organizationId)
          )
        )
        .limit(1)
        .pipe(Effect.map((rows) => rows[0] !== undefined)),

    completeTriageItem: ({
      organizationId,
      triageItemId,
      status,
      resolvedPostId,
      decidedByMemberId,
    }: {
      organizationId: string;
      triageItemId: string;
      status: "POST_CREATED" | "POST_LINKED" | "IGNORED";
      resolvedPostId: string | null;
      decidedByMemberId: string;
    }) =>
      db
        .update(schema.feedbackTriageItemTable)
        .set({
          status,
          resolvedPostId,
          decidedByMemberId,
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.feedbackTriageItemTable.id, triageItemId),
            eq(schema.feedbackTriageItemTable.organizationId, organizationId),
            eq(schema.feedbackTriageItemTable.status, "OPEN")
          )
        )
        .returning({ id: schema.feedbackTriageItemTable.id })
        .pipe(
          Effect.flatMap((rows) =>
            rows[0]
              ? Effect.void
              : Effect.fail(
                  new FeedbackTriageAlreadyDecidedError({
                    triageItemId,
                  })
                )
          )
        ),
  };
});

export class FeedbackIngestionRepository extends Context.Service<FeedbackIngestionRepository>()(
  "FeedbackIngestionRepository",
  { make: makeFeedbackIngestionRepository }
) {
  static readonly layer = Layer.effect(this, this.make);
}
