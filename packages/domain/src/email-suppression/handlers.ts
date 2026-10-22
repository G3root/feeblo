import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as Policy from "../policy";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
  withRemapDbErrors,
} from "../rpc-errors";
import { EmailSuppressionRepository } from "./repository";
import { EmailSuppressionRpcs } from "./rpcs";
import { EmailSuppressionDataError } from "./schema";
import {
  type EmailSuppressionAddRequest,
  type EmailSuppressionListRequest,
  type EmailSuppressionRecord,
  type EmailSuppressionRemoveRequest,
  type EmailSuppressionStatsRequest,
  type EmailSuppressionSummary,
} from "./schema";
import { recordEmailSuppression } from "./telemetry";

/** The role gate: admin and owner, inherited through the permission table. */
const canManage = (organizationId: string) =>
  Policy.canPermission(organizationId, "emailSuppressions.manage");

/**
 * Folds a stored-row decode failure into the response the client can act on.
 *
 * `mapError` rather than `catchTag`: the repository's inferred error channel is
 * the driver error for a read that found no rows, and the decoder failure for a
 * read that found an unreadable one, so matching by tag would make the helper's
 * type depend on that inference.
 */
const remapDataError = <A, R>(
  effect: Effect.Effect<
    A,
    EmailSuppressionDataError | EffectDrizzleQueryError,
    R
  >
): Effect.Effect<A, InternalServerError | EffectDrizzleQueryError, R> =>
  effect.pipe(
    Effect.mapError((error) =>
      Schema.is(EmailSuppressionDataError)(error)
        ? new InternalServerError({ message: error.reason })
        : error
    )
  );

/**
 * Narrows a stored row to the dashboard projection.
 *
 * Written field by field rather than spread: the record carries
 * `providerEventId`, which is provider detail the dashboard has no use for,
 * and naming each field is what keeps a future column from appearing in the UI
 * by accident.
 */
const toSummary = (
  record: EmailSuppressionRecord
): EmailSuppressionSummary => ({
  createdAt: record.createdAt,
  email: record.email,
  firstReason: record.firstReason,
  note: record.note,
  reason: record.reason,
  updatedAt: record.updatedAt,
});

export const EmailSuppressionRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* EmailSuppressionRepository;

  const failIfMissing = (record: EmailSuppressionRecord | undefined) =>
    record === undefined
      ? Effect.fail(new NotFoundError({ message: "Suppression not found" }))
      : Effect.succeed(record);

  return {
    ListEmailSuppressions: ({
      limit,
      offset,
      organizationId,
      reason,
      search,
    }: EmailSuppressionListRequest) =>
      repository
        .list({
          limit,
          offset,
          organizationId,
          ...(reason !== undefined && { reason }),
          ...(search !== undefined && { search }),
        })
        .pipe(
          remapDataError,
          Effect.map((result) => ({
            items: result.items.map(toSummary),
            total: result.total,
          })),
          Policy.withPolicy(canManage(organizationId)),
          withRemapDbErrors("EmailSuppression", "select")
        ),

    AddEmailSuppression: ({
      email,
      note,
      organizationId,
    }: EmailSuppressionAddRequest) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        yield* repository.upsert({
          email,
          note: note ?? null,
          now,
          organizationId,
          providerEventId: null,
          reason: "administrative_block",
        });
        yield* recordEmailSuppression("administrative_block", "manual");
        const record = yield* repository
          .find({ email, organizationId })
          .pipe(Effect.flatMap(failIfMissing));
        return toSummary(record);
      }).pipe(
        Effect.catchTags({
          EmailSuppressionDataError: (error) =>
            Effect.fail(new InternalServerError({ message: error.reason })),
          EmailSuppressionInputError: () =>
            Effect.fail(
              new BadRequestError({ message: "Email address is invalid" })
            ),
        }),
        Policy.withPolicy(canManage(organizationId)),
        withRemapDbErrors("EmailSuppression", "create")
      ),

    /**
     * Lifts a row this workspace owns.
     *
     * A row that does not exist and a row owned by another workspace are the
     * same answer on purpose: acknowledging the second would turn the RPC into
     * a cross-tenant address oracle.
     */
    RemoveEmailSuppression: ({
      email,
      organizationId,
    }: EmailSuppressionRemoveRequest) =>
      repository.remove({ email, organizationId }).pipe(
        remapDataError,
        Effect.flatMap((result) =>
          result.removed
            ? Effect.void
            : Effect.fail(
                new NotFoundError({ message: "Suppression not found" })
              )
        ),
        Policy.withPolicy(canManage(organizationId)),
        withRemapDbErrors("EmailSuppression", "delete")
      ),

    GetEmailSuppressionStats: ({
      organizationId,
    }: EmailSuppressionStatsRequest) =>
      repository
        .stats(organizationId)
        .pipe(
          remapDataError,
          Policy.withPolicy(canManage(organizationId)),
          withRemapDbErrors("EmailSuppression", "select")
        ),
  };
});

export const EmailSuppressionRpcHandlers = EmailSuppressionRpcs.toLayer(
  EmailSuppressionRpcHandlersEffect
).pipe(Layer.provide(EmailSuppressionRepository.layer));
