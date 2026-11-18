import {
  AuditActionSchema,
  AuditActorType,
  AuditOutcome,
} from "@feeblo/domain-contracts/audit";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as OpenApi from "effect/http-api/OpenApi";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { PublicApiAuditLogGroup } from "../../public-api/api-contract";
import {
  PUBLIC_API_ERROR_SCHEMAS,
  invalidRequestError,
} from "../../public-api/errors";
import type { HandlerOf } from "../../public-api/handler";
import type { PublicApiCaller } from "../../public-api/middleware";
import type { PublicApiDependencies } from "../../public-api/operations";
import { parseLimit } from "../../public-api/parse";
import { listAuditLogEntriesOperation } from "./operations";
import {
  ListAuditLogEntriesQuery,
  PublicApiAuditLogKind,
  PublicApiAuditLogPage,
} from "./schema";

/** The composed group, so a handler is typed with the group's middleware. */
type PublicApiGroup = InstanceType<typeof PublicApiAuditLogGroup>;

/**
 * One closed query vocabulary, decoded through the operation's own schema.
 *
 * The parameter is a string on the URL — a typed parameter would make the
 * framework reject a bad value with its own body, which is not this API's
 * envelope — and the schema decoded here is the one an MCP caller's argument is
 * validated against, so the two surfaces cannot accept different values.
 */
const parseChoice = <A>(
  schema: Schema.Decoder<A>,
  name: string,
  choices: string,
  raw: string | undefined
) =>
  Effect.gen(function* () {
    if (raw === undefined || raw.length === 0) {
      return undefined;
    }

    const decoded = Schema.decodeOption(schema)(raw);

    if (Option.isNone(decoded)) {
      return yield* invalidRequestError(`${name} must be ${choices}.`);
    }

    return decoded.value;
  });

/**
 * The audit-log endpoints, and their HTTP implementation.
 *
 * One read endpoint. There is deliberately no create, update, or delete: an
 * entry is written by the action it records, inside that action's transaction,
 * and a surface that could append or amend one could rewrite the record.
 */

export const auditLogEndpoints = [
  HttpApiEndpoint.get("listAuditLogEntries", "/audit-log", {
    query: ListAuditLogEntriesQuery,
    success: PublicApiAuditLogPage,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "List Audit Log Entries")
    .annotate(OpenApi.Summary, "List the workspace's audit log entries")
    .annotate(
      OpenApi.Description,
      "Returns the calling workspace's audit log, newest first, as a cursor-paginated page. An entry records what a member, an API key, an OAuth client, or the product itself did to the workspace, and every request refused at the credential boundary. Filter by the half of the log (`kind`), the action, the outcome, the kind of actor, or a time window. Origin addresses, user agents, and request ids are never returned."
    ),
] as const;

export const auditLogHandlers = (
  context: Context.Context<PublicApiDependencies>
) => ({
  listAuditLogEntries: (({ query }) =>
    Effect.gen(function* () {
      const limit = yield* parseLimit(query.limit);

      const action = yield* parseChoice(
        AuditActionSchema,
        "action",
        "a declared audit action",
        query.action
      );

      const outcome = yield* parseChoice(
        AuditOutcome,
        "outcome",
        "allowed or denied",
        query.outcome
      );

      const actorType = yield* parseChoice(
        AuditActorType,
        "actorType",
        "user, api_key, oauth_client, or system",
        query.actorType
      );

      const kind = yield* parseChoice(
        PublicApiAuditLogKind,
        "kind",
        "changes or access",
        query.kind
      );

      return yield* listAuditLogEntriesOperation.handler({
        action,
        actorType,
        cursor: query.cursor,
        kind,
        limit,
        outcome,
        since: query.since,
        until: query.until,
      });
    }).pipe(Effect.provideContext(context))) satisfies HandlerOf<
    PublicApiGroup,
    "listAuditLogEntries",
    PublicApiCaller
  >,
});
