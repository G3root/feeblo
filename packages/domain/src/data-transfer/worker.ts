import { transaction, type Database } from "@feeblo/db";
import { LegidError, PostId } from "@feeblo/id";
import { sanitizeMarkdown } from "@feeblo/utils/markdown-sanitizer";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import {
  CrmEntryLimitReachedError,
  InvalidSubjectError,
} from "../identity/errors";
import { PostStatusRepository } from "../post-status/repository";
import {
  PostEmbeddingService,
  generatePostEmbedding,
} from "../post/embedding-service";
import { PostWriteService, type PostWriteActor } from "../post/write";
import { TagRepository } from "../tag/repository";
import { UserRepository } from "../user/repository";
import {
  DATA_IMPORT_BATCH_SIZE,
  DATA_IMPORT_LEASE_MS,
  DATA_IMPORT_POLL_MS,
} from "./limits";
import {
  type ClaimedDataImportJob,
  DataTransferRepository,
  type DataImportJobRecord,
  type PendingDataImportRow,
} from "./repository";

export type DataImportPassOutcome = {
  readonly jobId: string;
  readonly createdCount: number;
  readonly errorCount: number;
};

type EmbeddingInput = {
  readonly content: string;
  readonly postId: string;
  readonly title: string;
};

/** An error carrying a tag — the shape both Schema and Effect failures share. */
type TaggedFailure = { readonly _tag?: unknown };

type RowOutcome =
  | { readonly kind: "created"; readonly embedding: EmbeddingInput }
  | { readonly kind: "failed" };

const normalizeTagKey = (name: string): string => name.trim().toLowerCase();

const errorTag = (error: TaggedFailure): string =>
  Predicate.hasProperty(error, "_tag") && Predicate.isString(error._tag)
    ? error._tag
    : "UnknownError";

/**
 * Failures that blame the row rather than the pass: a customer-slot limit the
 * row hit, an author the resolver refused, or a validation the write path
 * rejected. The row is recorded as failed and the pass continues.
 */
const isInfrastructureFailure = (error: TaggedFailure): boolean =>
  Schema.is(EffectDrizzleQueryError)(error) ||
  Schema.is(LegidError)(error) ||
  Predicate.isTagged(error, "InternalServerError") ||
  Predicate.isTagged(error, "SqlError") ||
  Predicate.isTagged(error, "DataTransferRepositoryError") ||
  Predicate.isTagged(error, "DataImportPassFailedError");

const rowFailureMessage = (error: TaggedFailure): string => {
  if (Schema.is(CrmEntryLimitReachedError)(error)) {
    return "The workspace has no customer slots left; free one and retry this import.";
  }
  if (Schema.is(InvalidSubjectError)(error)) {
    return "The row's author could not be resolved.";
  }
  return "The post could not be created.";
};

const resolveImportActor = (
  job: DataImportJobRecord
): Effect.Effect<PostWriteActor, EffectDrizzleQueryError, UserRepository> => {
  const userId = job.createdByUserId;
  if (userId === null) {
    return Effect.succeed<PostWriteActor>({ kind: "import" });
  }
  return Effect.gen(function* () {
    const users = yield* UserRepository;
    const user = yield* users.getById(userId);
    return Option.match(user, {
      onNone: (): PostWriteActor => ({ kind: "import" }),
      onSome: (found): PostWriteActor => ({
        email: found.email,
        kind: "member",
        memberId: job.createdByMemberId,
        name: found.name,
        userId: found.id,
      }),
    });
  });
};

/**
 * Resolves every tag name the batch mentions to a tag id, creating the ones
 * that do not exist yet.
 *
 * Runs outside the row writes on purpose: a tag insert losing a race against
 * a concurrent dashboard edit would otherwise poison a row's transaction. A
 * failed create re-reads once and uses the winner.
 */
const resolveBatchTags = ({
  organizationId,
  rows,
}: {
  readonly organizationId: string;
  readonly rows: readonly PendingDataImportRow[];
}): Effect.Effect<
  ReadonlyMap<string, string>,
  EffectDrizzleQueryError,
  TagRepository
> =>
  Effect.gen(function* () {
    const tags = yield* TagRepository;
    const byKey = new Map<string, string>();

    const remember = (
      candidates: readonly {
        readonly id: string;
        readonly name: string;
        readonly slug: string;
      }[]
    ) => {
      for (const tag of candidates) {
        const nameKey = normalizeTagKey(tag.name);
        const slugKey = normalizeTagKey(tag.slug);
        if (!byKey.has(nameKey)) {
          byKey.set(nameKey, tag.id);
        }
        if (!byKey.has(slugKey)) {
          byKey.set(slugKey, tag.id);
        }
      }
    };

    remember(yield* tags.findMany({ organizationId }));

    const wanted = new Map<string, string>();
    for (const row of rows) {
      for (const name of row.payload?.tagNames ?? []) {
        const key = normalizeTagKey(name);
        if (!byKey.has(key) && !wanted.has(key)) {
          wanted.set(key, name);
        }
      }
    }

    for (const name of wanted.values()) {
      const created = yield* tags
        .create({ name, organizationId })
        .pipe(Effect.orElseSucceed(() => undefined));
      if (created !== undefined) {
        remember([created]);
        continue;
      }
      // The name won a race (or the insert failed for a reason a re-read can
      // repair); one re-read is the cheapest correct recovery.
      remember(
        yield* tags
          .findMany({ organizationId })
          .pipe(Effect.orElseSucceed((): [] => []))
      );
    }

    return byKey;
  });

/**
 * Applies one `pending` row and records its outcome.
 *
 * The post write and the row's ledger update share a transaction, so a crash
 * between them cannot leave a post whose row still says `pending` (which a
 * resumed pass would create twice). Everything in one row is one commit.
 */
const applyPendingRow = ({
  actor,
  defaultStatusId,
  job,
  repository,
  row,
  tagIdsByKey,
  tags,
  writes,
}: {
  readonly actor: PostWriteActor;
  readonly defaultStatusId: string;
  readonly job: DataImportJobRecord;
  readonly repository: DataTransferRepository["Service"];
  readonly row: PendingDataImportRow;
  readonly tagIdsByKey: ReadonlyMap<string, string>;
  readonly tags: TagRepository["Service"];
  readonly writes: PostWriteService["Service"];
}) =>
  Effect.gen(function* () {
    const payload = row.payload;
    if (payload === null) {
      yield* repository.markRowFailed({
        message: "The staged row is unreadable.",
        rowId: row.id,
      });
      return { kind: "failed" } satisfies RowOutcome;
    }

    const applied = yield* transaction(
      Effect.gen(function* () {
        const postId = yield* PostId.generate;
        const createdAt = Option.getOrUndefined(
          Option.map(
            payload.createdAt === null
              ? Option.none()
              : DateTime.make(payload.createdAt),
            DateTime.toDate
          )
        );
        yield* writes.create(
          {
            assetIds: [],
            ...(payload.authorEmail !== null && {
              author: {
                email: payload.authorEmail,
                ...(payload.authorName !== null && {
                  name: payload.authorName,
                }),
              },
            }),
            boardId: job.boardId,
            content: payload.content,
            ...(createdAt !== undefined && { createdAt }),
            ...(payload.etaQuarter !== null && {
              etaQuarter: payload.etaQuarter,
            }),
            id: postId,
            organizationId: job.organizationId,
            source: "IMPORT",
            statusId: payload.statusId ?? defaultStatusId,
            title: payload.title,
          },
          actor,
          { mode: "backfill" }
        );

        const tagIds = payload.tagNames
          .map((name) => tagIdsByKey.get(normalizeTagKey(name)))
          .filter((id): id is string => id !== undefined);
        if (tagIds.length > 0) {
          yield* tags.setPostTags({
            organizationId: job.organizationId,
            postId,
            tagIds,
          });
        }

        yield* repository.markRowCreated({ postId, rowId: row.id });
        return {
          content: sanitizeMarkdown(payload.content).sanitizedMarkdown,
          postId,
          title: payload.title,
        } satisfies EmbeddingInput;
      })
    ).pipe(
      Effect.map((embedding): RowOutcome => ({ embedding, kind: "created" })),
      Effect.catchIf(
        (error) => !isInfrastructureFailure(error),
        (error) =>
          Effect.gen(function* () {
            yield* Effect.logWarning("DataImport.row_failed").pipe(
              Effect.annotateLogs({
                errorTag: errorTag(error),
                jobId: job.id,
                rowNumber: row.rowNumber,
              })
            );
            yield* repository.markRowFailed({
              message: rowFailureMessage(error),
              rowId: row.id,
            });
            return { kind: "failed" } satisfies RowOutcome;
          })
      )
    );

    return applied;
  });

const embedCreatedPosts = ({
  embeddings,
  organizationId,
}: {
  readonly embeddings: readonly EmbeddingInput[];
  readonly organizationId: string;
}): Effect.Effect<void, never, Database.Database> =>
  Effect.gen(function* () {
    if (embeddings.length === 0) {
      return;
    }
    const service = yield* Effect.serviceOption(PostEmbeddingService);
    if (Option.isNone(service)) {
      return;
    }
    yield* Effect.forEach(
      embeddings,
      (embedding) =>
        generatePostEmbedding({
          content: embedding.content,
          organizationId,
          postId: embedding.postId,
          title: embedding.title,
        }).pipe(
          Effect.provideService(PostEmbeddingService, service.value),
          Effect.catchCause((cause) =>
            Effect.logWarning("DataImport.embedding_failed", cause).pipe(
              Effect.annotateLogs({ postId: embedding.postId })
            )
          )
        ),
      { concurrency: 4, discard: true }
    );
  });

/**
 * Applies every `pending` row of a claimed job, in bounded batches, until none
 * are left or the job stops being `running` (a cancel).
 *
 * A pass that fails for an infrastructure reason is recorded as `failed`
 * rather than retried in a hot loop: the rows already created are kept, the
 * job releases its workspace slot, and the report still shows which rows are
 * still pending. A process crash is different — the lease expires, the job is
 * re-claimed, and the pass resumes from the ledger.
 */
export const runDataImportPass = (claim: ClaimedDataImportJob) => {
  const { job, leaseOwner } = claim;
  return Effect.gen(function* () {
    const repository = yield* DataTransferRepository;
    const tags = yield* TagRepository;
    const statuses = yield* PostStatusRepository;
    const writes = yield* PostWriteService;
    const actor = yield* resolveImportActor(job);

    const statusRows = yield* statuses.findMany({
      organizationId: job.organizationId,
    });
    const defaultStatus =
      statusRows.find((status) => status.type === "PENDING") ?? statusRows[0];
    if (defaultStatus === undefined) {
      yield* repository.finishJob({
        failureMessage:
          "This workspace has no post statuses; add one before importing.",
        jobId: job.id,
        leaseOwner,
        status: "failed",
      });
      return { createdCount: 0, errorCount: 0, jobId: job.id };
    }

    const runBatches = Effect.gen(function* () {
      while (true) {
        // Renew before doing any work: a lease that has moved on must not
        // create posts, rewrite counts, or finalize the job.
        const renewed = yield* repository.renewLease({
          jobId: job.id,
          leaseDurationMs: DATA_IMPORT_LEASE_MS,
          leaseOwner,
        });
        if (!renewed) {
          return yield* repository
            .syncCounts({ jobId: job.id, leaseOwner })
            .pipe(Effect.map((counts) => ({ ...counts, jobId: job.id })));
        }

        const stillRunning = yield* repository.isStillRunning({
          jobId: job.id,
        });
        if (!stillRunning) {
          return yield* repository
            .syncCounts({ jobId: job.id, leaseOwner })
            .pipe(Effect.map((counts) => ({ ...counts, jobId: job.id })));
        }

        const rows = yield* repository.listPendingRows({
          jobId: job.id,
          limit: DATA_IMPORT_BATCH_SIZE,
        });
        if (rows.length === 0) {
          break;
        }

        const tagIdsByKey = yield* resolveBatchTags({
          organizationId: job.organizationId,
          rows,
        });
        const embeddings: EmbeddingInput[] = [];
        for (const row of rows) {
          const outcome = yield* applyPendingRow({
            actor,
            defaultStatusId: defaultStatus.id,
            job,
            repository,
            row,
            tagIdsByKey,
            tags,
            writes,
          });
          if (outcome.kind === "created") {
            embeddings.push(outcome.embedding);
          }
        }

        yield* repository.syncCounts({ jobId: job.id, leaseOwner });
        yield* embedCreatedPosts({
          embeddings,
          organizationId: job.organizationId,
        });
      }

      const counts = yield* repository.syncCounts({
        jobId: job.id,
        leaseOwner,
      });
      yield* repository.finishJob({
        jobId: job.id,
        leaseOwner,
        status: "completed",
      });
      return { ...counts, jobId: job.id };
    });

    return yield* runBatches.pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          yield* Effect.logError("DataImport.pass_failed").pipe(
            Effect.annotateLogs({ errorTag: errorTag(error), jobId: job.id })
          );
          yield* repository.finishJob({
            failureMessage:
              "The import stopped unexpectedly. Posts created before the stop were kept.",
            jobId: job.id,
            leaseOwner,
            status: "failed",
          });
          return { createdCount: 0, errorCount: 0, jobId: job.id };
        })
      )
    );
  });
};

/**
 * Polls for claimable imports and runs a pass for each, forever.
 *
 * A failed pass is logged and the loop continues: the worker's job is to keep
 * the queue moving, not to stop because one workspace's import hit a database
 * error. Each pass ends by releasing its lease, so a crash is recovered by the
 * next poll that finds an expired lease.
 */
export const runDataImportWorker = ({
  leaseDurationMs = DATA_IMPORT_LEASE_MS,
  pollIntervalMs = DATA_IMPORT_POLL_MS,
}: {
  readonly leaseDurationMs?: number;
  readonly pollIntervalMs?: number;
} = {}) =>
  Effect.gen(function* () {
    const repository = yield* DataTransferRepository;
    const crypto = yield* Crypto.Crypto;
    const leaseOwner = yield* crypto.randomUUIDv4.pipe(Effect.orDie);

    const poll = Effect.gen(function* () {
      const claim = yield* repository.claimNextJob({
        leaseDurationMs,
        leaseOwner,
      });
      if (Option.isNone(claim)) {
        return;
      }
      yield* runDataImportPass(claim.value);
    }).pipe(
      Effect.catch((error) =>
        Effect.logError("DataImport.worker_pass_failed").pipe(
          Effect.annotateLogs({ errorTag: errorTag(error) })
        )
      ),
      Effect.ignore
    );

    return yield* poll.pipe(
      Effect.repeat(Schedule.spaced(Duration.millis(pollIntervalMs))),
      Effect.asVoid
    );
  });

/** Deletes jobs past their retention window; runs on the worker's own clock. */
export const runDataImportMaintenance: Effect.Effect<
  void,
  never,
  DataTransferRepository
> = Effect.gen(function* () {
  const repository = yield* DataTransferRepository;
  return yield* repository.deleteExpiredJobs.pipe(
    Effect.tapError((error) =>
      Effect.logWarning("DataImport.retention_sweep_failed").pipe(
        Effect.annotateLogs({ errorTag: errorTag(error) })
      )
    ),
    Effect.ignore,
    Effect.repeat(Schedule.spaced(Duration.hours(1))),
    Effect.asVoid
  );
});

/**
 * Everything the import worker reads besides the shared post write path,
 * assembled where the worker lives. The composition root merges this with
 * `PostWriteService` and the optional fan-outs the write path reads from the
 * request context.
 */
export const DataImportWorkerLive = Layer.mergeAll(
  DataTransferRepository.layer,
  PostStatusRepository.layer,
  TagRepository.layer,
  UserRepository.layer
);
