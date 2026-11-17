import {
  auditActionLabel,
  auditResourceLabel,
} from "@feeblo/domain-contracts/audit";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as Policy from "../policy";
import { InternalServerError, withRemapDbErrors } from "../rpc-errors";
import { AuditLogDataError } from "./errors";
import { AuditLogRepository } from "./repository";
import { AuditLogRpcs } from "./rpcs";
import type {
  TAuditLogEntry,
  TAuditLogListRequest,
  TAuditLogStoredEntry,
} from "./schema";

/**
 * Reading the log is an administrator's view of every member's activity, of
 * the workspace's refusal history, and of origin addresses — the most
 * aggregated sensitive surface the dashboard has. `admin` and above hold
 * `auditLog.read`; the permission table is the one place that decides, and the
 * frontend gates the page on the same bit.
 */
const canRead = (organizationId: string) =>
  Policy.canPermission(organizationId, "auditLog.read");

/**
 * Adds the labels this build knows. An entry whose action was recorded by a
 * newer build reads as `null` rather than failing the page: an audit log that
 * refuses to show older entries is worse than one showing an id.
 */
const toEntry = (entry: TAuditLogStoredEntry): TAuditLogEntry => ({
  ...entry,
  actionLabel: auditActionLabel(entry.action),
  resourceLabel: auditResourceLabel(entry.resourceType),
});

/**
 * Folds a decode failure into the response the client can act on.
 *
 * `mapError` rather than `catchTag`: the repository's inferred channel is the
 * driver error for a read that found nothing and this error for a row that did
 * not decode, so a tag match would make the helper's type depend on that
 * inference.
 */
const remapDataError = <A, R>(
  effect: Effect.Effect<A, AuditLogDataError | EffectDrizzleQueryError, R>
): Effect.Effect<A, InternalServerError | EffectDrizzleQueryError, R> =>
  effect.pipe(
    Effect.mapError((error) =>
      Schema.is(AuditLogDataError)(error)
        ? new InternalServerError({ message: error.reason })
        : error
    )
  );

export const AuditLogRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* AuditLogRepository;

  return {
    ListAuditLogEntries: (args: TAuditLogListRequest) =>
      repository.findPage(args).pipe(
        remapDataError,
        Effect.map((page) => ({
          items: page.items.map(toEntry),
          next: page.next,
        })),
        Policy.withPolicy(canRead(args.organizationId)),
        withRemapDbErrors("AuditLog", "select")
      ),
  };
});

export const AuditLogRpcHandlers = AuditLogRpcs.toLayer(
  AuditLogRpcHandlersEffect
).pipe(Layer.provide(AuditLogRepository.layer));
