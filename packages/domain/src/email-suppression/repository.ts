import { currentDb, schema } from "@feeblo/db";
import type { TEmailSuppressionReason } from "@feeblo/db/validation-schema/email";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  like,
  or,
  sql,
} from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  EmailSuppressionDataError,
  type EmailSuppressionRecord,
  EmailSuppressionRecord as EmailSuppressionRecordSchema,
  parseSuppressionEmail,
} from "./schema";

export type EmailSuppressionReason = TEmailSuppressionReason;

/**
 * The workspace a suppression belongs to, or `null` for a platform row.
 *
 * A platform row is written when the bounced mail belongs to no workspace —
 * account verification, password reset, invitations. It matches every sender,
 * because the address itself is the fact.
 */
export type EmailSuppressionScope = {
  readonly organizationId: string | null;
};

export type UpsertEmailSuppressionInput = EmailSuppressionScope & {
  readonly email: string;
  /** Operator context for a manual block; never provider detail. */
  readonly note?: string | null;
  readonly now: Date;
  /**
   * The provider event this write came from, or null for a synchronous SMTP
   * rejection or a manual block. Only attached when the event names exactly
   * one recipient, because the column is unique per event.
   */
  readonly providerEventId: string | null;
  readonly reason: EmailSuppressionReason;
};

export type ListEmailSuppressionsInput = {
  readonly limit: number;
  readonly offset: number;
  readonly organizationId: string;
  readonly reason?: EmailSuppressionReason;
  readonly search?: string;
};

const dataError = (
  operation: string,
  reason: string,
  cause?: unknown
): EmailSuppressionDataError =>
  new EmailSuppressionDataError({
    ...(cause !== undefined && { cause }),
    operation,
    reason,
  });

/**
 * Ranks the reasons so a later event never weakens a row: a complaint outranks
 * a manual block, which outranks a hard bounce. The original cause survives in
 * `first_reason`, so "why was this address suppressed" stays answerable.
 */
const reasonRank = (reason: TEmailSuppressionReason): number => {
  switch (reason) {
    case "complaint":
      return 3;
    case "administrative_block":
      return 2;
    case "hard_bounce":
      return 1;
  }
};

const table = schema.emailSuppressionTable;

const strengthenedReason = (reason: EmailSuppressionReason) =>
  sql`case when ${reasonRank(reason)} >= case ${table.reason} when 'complaint' then 3 when 'administrative_block' then 2 else 1 end then ${reason} else ${table.reason} end`;

/**
 * The rows that apply to one sender.
 *
 * A workspace sees its own rows and the platform rows; it never sees another
 * workspace's row, which is why a complaint cannot be discovered by — or
 * removed from — a different tenant.
 */
const scopeCondition = (organizationId: string | null) =>
  organizationId === null
    ? isNull(table.organizationId)
    : or(
        isNull(table.organizationId),
        eq(table.organizationId, organizationId)
      );

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the type parameter is how this helper accepts any value without spelling `unknown`, which `anti-slop/no-unknown-parameters` bans (the established spelling is `packages/utils/src/runtime-kind.ts`); the parameter is used once by construction
const decodeRecord = <V>(
  input: V,
  operation: string
): Effect.Effect<EmailSuppressionRecord, EmailSuppressionDataError> =>
  Schema.decodeUnknownEffect(EmailSuppressionRecordSchema)(input).pipe(
    Effect.mapError(() =>
      dataError(operation, "Stored email suppression is invalid")
    )
  );

const escapeLikePattern = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");

const makeEmailSuppressionRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  /**
   * Writes one suppression row, creating it or strengthening an existing one.
   *
   * Idempotent by (scope, address): a redelivered provider event, a repeated
   * SMTP rejection and a manual block all converge on the same row. The
   * `first_reason` of the existing row is never overwritten, and a manual note
   * is never cleared by a provider event.
   */
  const upsert = Effect.fn("EmailSuppressionRepository.upsert")(function* (
    input: UpsertEmailSuppressionInput
  ) {
    const email = yield* parseSuppressionEmail(input.email, "upsert");
    const values = {
      email,
      organizationId: input.organizationId,
      reason: input.reason,
      firstReason: input.reason,
      note: input.note ?? null,
      providerEventId: input.providerEventId,
      createdAt: input.now,
      updatedAt: input.now,
    } as const;

    const [row] =
      input.organizationId === null
        ? yield* db
            .insert(table)
            .values(values)
            .onConflictDoUpdate({
              target: table.email,
              targetWhere: sql`${table.organizationId} is null`,
              set: {
                note: sql`coalesce(excluded.note, ${table.note})`,
                providerEventId: sql`coalesce(excluded.provider_event_id, ${table.providerEventId})`,
                reason: strengthenedReason(input.reason),
                updatedAt: sql`greatest(${table.updatedAt}, ${input.now})`,
              },
            })
            .returning()
        : yield* db
            .insert(table)
            .values(values)
            .onConflictDoUpdate({
              target: [table.organizationId, table.email],
              targetWhere: sql`${table.organizationId} is not null`,
              set: {
                note: sql`coalesce(excluded.note, ${table.note})`,
                providerEventId: sql`coalesce(excluded.provider_event_id, ${table.providerEventId})`,
                reason: strengthenedReason(input.reason),
                updatedAt: sql`greatest(${table.updatedAt}, ${input.now})`,
              },
            })
            .returning();

    if (row === undefined) {
      return yield* dataError(
        "upsert",
        "Email suppression conflict did not resolve to a stored row"
      );
    }
  });

  /**
   * Whether one address is suppressed for this sender.
   *
   * The send path passes the intent's workspace so a complaint written by one
   * workspace does not stop another's mail. Auth mail passes `null`, which
   * reads only platform rows: a workspace's complaint is not about the
   * platform's password reset.
   */
  const isSuppressed = Effect.fn("EmailSuppressionRepository.isSuppressed")(
    function* (input: {
      readonly email: string;
      readonly organizationId: string | null;
    }) {
      const email = input.email.trim().toLowerCase();
      const [row] = yield* db
        .select({ email: table.email })
        .from(table)
        .where(
          and(eq(table.email, email), scopeCondition(input.organizationId))
        )
        .limit(1);
      return row !== undefined;
    }
  );

  /** One workspace-owned row, for the add RPC's response. */
  const find = Effect.fn("EmailSuppressionRepository.find")(function* (input: {
    readonly email: string;
    readonly organizationId: string;
  }) {
    const email = input.email.trim().toLowerCase();
    const [row] = yield* db
      .select()
      .from(table)
      .where(
        and(
          eq(table.email, email),
          eq(table.organizationId, input.organizationId)
        )
      )
      .limit(1);
    return row === undefined ? undefined : yield* decodeRecord(row, "find");
  });

  /** The subset of the given addresses this sender must not mail. */ const findSuppressedEmails =
    Effect.fn("EmailSuppressionRepository.findSuppressedEmails")(
      function* (input: {
        readonly emails: readonly string[];
        readonly organizationId: string | null;
      }) {
        const emails = [
          ...new Set(input.emails.map((email) => email.trim().toLowerCase())),
        ];
        if (emails.length === 0) {
          return new Set<string>();
        }
        const rows = yield* db
          .select({ email: table.email })
          .from(table)
          .where(
            and(
              inArray(table.email, emails),
              scopeCondition(input.organizationId)
            )
          );
        return new Set(rows.map((row) => row.email));
      }
    );

  /** Dashboard listing; platform rows stay invisible to every tenant. */
  const list = Effect.fn("EmailSuppressionRepository.list")(function* (
    input: ListEmailSuppressionsInput
  ) {
    const search = input.search?.trim();
    const searchCondition =
      search === undefined || search === ""
        ? undefined
        : like(table.email, `%${escapeLikePattern(search.toLowerCase())}%`);
    const condition = and(
      eq(table.organizationId, input.organizationId),
      input.reason === undefined ? undefined : eq(table.reason, input.reason),
      searchCondition
    );

    const [items, [total]] = yield* Effect.all([
      db
        .select()
        .from(table)
        .where(condition)
        .orderBy(desc(table.createdAt), asc(table.email))
        .limit(input.limit)
        .offset(input.offset),
      db.select({ total: count() }).from(table).where(condition),
    ]);

    const records = yield* Effect.forEach(items, (item) =>
      decodeRecord(item, "list")
    );
    return {
      items: records,
      total: total?.total ?? 0,
    };
  });

  /**
   * Removes one workspace-owned row. A platform row, or another workspace's
   * row, is not addressable from here: the caller's email may match it, but the
   * scope condition keeps the delete inside the caller's tenant.
   */
  const remove = Effect.fn("EmailSuppressionRepository.remove")(
    function* (input: {
      readonly email: string;
      readonly organizationId: string;
    }) {
      const email = input.email.trim().toLowerCase();
      const removed = yield* db
        .delete(table)
        .where(
          and(
            eq(table.email, email),
            eq(table.organizationId, input.organizationId)
          )
        )
        .returning({ email: table.email });
      return { removed: removed.length > 0 };
    }
  );

  const stats = Effect.fn("EmailSuppressionRepository.stats")(function* (
    organizationId: string
  ) {
    const rows = yield* db
      .select({ reason: table.reason, total: count() })
      .from(table)
      .where(eq(table.organizationId, organizationId))
      .groupBy(table.reason);

    const result = {
      administrativeBlock: 0,
      complaint: 0,
      hardBounce: 0,
      total: 0,
    };
    for (const row of rows) {
      const key =
        row.reason === "complaint"
          ? "complaint"
          : row.reason === "administrative_block"
            ? "administrativeBlock"
            : "hardBounce";
      result[key] += row.total;
      result.total += row.total;
    }
    return result;
  });

  return {
    find,
    findSuppressedEmails,
    isSuppressed,
    list,
    remove,
    stats,
    upsert,
  };
});

/** Durable suppression list shared by the send path, feedback and the dashboard. */
export class EmailSuppressionRepository extends Context.Service<EmailSuppressionRepository>()(
  "EmailSuppressionRepository",
  { make: makeEmailSuppressionRepository }
) {
  static readonly layer = Layer.effect(this, this.make);
}
