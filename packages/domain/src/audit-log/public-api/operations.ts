import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { PUBLIC_API_PAGE_DEFAULT_LIMIT } from "../../public-api/common";
import {
  InternalError,
  InvalidRequestError,
  invalidRequestError,
} from "../../public-api/errors";
import { onInternalError } from "../../public-api/failure";
import { PublicApiCaller } from "../../public-api/middleware";
import { defineOperation } from "../../public-api/operation";
import { isIsoDateOrTimestamp } from "../../public-api/parse";
import { withRemapDbErrors } from "../../rpc-errors";
import { AuditLogDataError } from "../errors";
import { AuditLogRepository } from "../repository";
import { toAuditLogSource, toPublicApiAuditLogEntry } from "./mappers";
import { ListAuditLogEntriesInput, PublicApiAuditLogPage } from "./schema";

/**
 * The audit log's cursor.
 *
 * The shared public cursor pages on `(createdAt, id)`, and this table has no
 * `createdAt`: its rows are sorted by when the action happened, so paging on the
 * write time would order and resume by the wrong column. The payload is the
 * sort key of the last entry the caller received, base64url encoded so callers
 * treat it as opaque — it carries a timestamp and an id the caller already has,
 * and the query is scoped to the calling workspace, so a forged cursor can
 * only move a caller around its own log.
 */
const AuditLogCursorPayload = Schema.Struct({
  id: Schema.String,
  occurredAt: Schema.DateFromString,
});

const decodeAuditLogCursorPayload = Schema.decodeUnknownOption(
  Schema.fromJsonString(AuditLogCursorPayload)
);

type TAuditLogPageCursor = Schema.Schema.Type<typeof AuditLogCursorPayload>;

const encodeAuditLogCursor = (cursor: TAuditLogPageCursor): string =>
  Buffer.from(
    JSON.stringify({
      id: cursor.id,
      occurredAt: cursor.occurredAt.toISOString(),
    }),
    "utf8"
  ).toString("base64url");

/**
 * The cursor an operation was given, or the published refusal.
 *
 * Ignoring an unreadable cursor would silently return the first page forever,
 * so a malformed value is `INVALID_REQUEST` rather than "no cursor".
 */
const decodeAuditLogCursorOrFail = (raw: string | undefined) =>
  Effect.gen(function* () {
    if (raw === undefined || raw.length === 0) {
      return null;
    }

    const decoded = Option.getOrNull(
      decodeAuditLogCursorPayload(
        Buffer.from(raw, "base64url").toString("utf8")
      )
    );
    if (decoded === null) {
      return yield* invalidRequestError("cursor is not a valid page cursor.");
    }

    return decoded;
  });

/**
 * One of the list's date bounds, parsed here so both surfaces agree.
 *
 * The operation input carries `since` and `until` as strings — the HTTP query
 * parameter and the MCP tool argument are the same value — and the check is the
 * post list's: `Schema.DateFromString` alone accepts host formats and rolls a
 * day that does not exist into the next month.
 */
const parseInstant = (raw: string | undefined, name: "since" | "until") =>
  Effect.gen(function* () {
    const trimmed = raw?.trim();
    if (trimmed === undefined || trimmed.length === 0) {
      return undefined;
    }

    if (!isIsoDateOrTimestamp(trimmed)) {
      return yield* invalidRequestError(
        `${name} must be an ISO 8601 date or timestamp naming a real date.`
      );
    }

    const decoded = Option.getOrNull(
      Schema.decodeOption(Schema.DateFromString)(trimmed)
    );
    if (decoded === null) {
      // Unreachable while the shape and calendar checks above hold; kept so
      // the decoder remains the authority on what an instant is.
      return yield* invalidRequestError(
        `${name} must be an ISO 8601 date or timestamp naming a real date.`
      );
    }

    return decoded;
  });

/** The read vocabulary: a log read has nothing to collide with and no 404. */
const AUDIT_LOG_READ_FAILURES = Schema.Union([
  InvalidRequestError,
  InternalError,
]);

/**
 * The audit log's one operation.
 *
 * Reading the log is an administrator's view of every member's activity, of the
 * workspace's refusal history, and of the credentials that acted. The scope is
 * the capability: `audit_log.read` is not part of a key's default grant, so a
 * key minted to read feedback cannot learn who changed what.
 *
 * No operation writes an entry. An entry is a by-product of the action it
 * records, written in that action's transaction (see `docs/audit-log.md`); a
 * surface that could append or amend one would be a surface that could rewrite
 * the record.
 *
 * There is no `resourceType` filter although the repository supports one: the
 * published input is deliberately the small set an integration uses — what
 * happened, to what kind of actor, in what window — and adding a filter is
 * additive later.
 */
export const listAuditLogEntriesOperation = defineOperation(
  "listAuditLogEntries",
  {
    annotations: { idempotent: true, readOnly: true },
    description:
      "List the calling workspace's audit log entries, newest first, as a cursor-paginated page. An entry records what a member, an API key, an OAuth client or the product itself did to the workspace, and every request refused at the credential boundary. Entries carry no origin address, user agent or request id.",
    failure: AUDIT_LOG_READ_FAILURES,
    input: ListAuditLogEntriesInput,
    output: PublicApiAuditLogPage,
    scope: "audit_log.read",
  },
  ({ action, actorType, cursor, kind, limit, outcome, since, until }) =>
    Effect.gen(function* () {
      const caller = yield* PublicApiCaller;
      const auditLog = yield* AuditLogRepository;

      const after = yield* decodeAuditLogCursorOrFail(cursor);
      const sinceInstant = yield* parseInstant(since, "since");
      const untilInstant = yield* parseInstant(until, "until");
      const pageSize = limit ?? PUBLIC_API_PAGE_DEFAULT_LIMIT;

      const page = yield* auditLog
        .findPage({
          action,
          after: after ?? undefined,
          kind,
          limit: pageSize,
          organizationId: caller.organizationId,
          outcome,
          since: sinceInstant,
          until: untilInstant,
        })
        .pipe(
          // The repository reports a row it could not decode as its own
          // error; the published vocabulary has one unexpected-failure code,
          // so a caller never sees the driver detail behind it.
          Effect.mapError((error) =>
            Schema.is(AuditLogDataError)(error)
              ? new InternalError({
                  message: "The audit log entry could not be read.",
                })
              : error
          ),
          withRemapDbErrors("PublicApiAuditLog", "select"),
          Effect.catchTag("InternalServerError", () => onInternalError)
        );

      // `actor_type` is a column of the row but not a filter of the repository's
      // keyset query — that query narrows the actor by user id, and the public
      // input names the kind of actor instead. The type is applied to the page
      // after it is read, which keeps paging correct: the cursor still comes
      // from the last row read, so an entry is never skipped or repeated, but a
      // filtered page can hold fewer than `limit` entries while `nextCursor` is
      // still set. The alternative would be a second ordering in the repository
      // that this surface alone reads.
      const entries =
        actorType === undefined
          ? page.items
          : page.items.filter((entry) => entry.actorType === actorType);

      return {
        data: entries.map((entry) =>
          toPublicApiAuditLogEntry(toAuditLogSource(entry))
        ),
        nextCursor: page.next === null ? null : encodeAuditLogCursor(page.next),
      };
    })
);

export const auditLogOperations = [listAuditLogEntriesOperation] as const;
