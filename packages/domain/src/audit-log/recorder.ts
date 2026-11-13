import {
  type TAuditAction,
  type TAuditActorType,
  type TAuditChanges,
  type TAuditLogSource,
  type TAuditMetadata,
  type TAuditOutcome,
  auditResourceTypeOf,
} from "@feeblo/domain-contracts/audit";
import { AuditLogId } from "@feeblo/id";
import type { Role } from "@feeblo/permissions";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AuditLogEnabled } from "./flag";
import { AuditLogRepository } from "./repository";

/**
 * The credential behind an audited action.
 *
 * `label` is the credential's name frozen at write time — the name a key had
 * when it acted is the audit fact, and the key is often revoked next. A
 * person's name is deliberately *not* frozen: it is resolved from the member
 * directory when the log is read, so a rename corrects it and a departed
 * member shows their id, which is honest.
 */
export interface TAuditActorRef {
  readonly type: TAuditActorType;
  /** The person behind the action: a session user, or an OAuth grant's subject. */
  readonly userId?: string | undefined;
  /** The machine credential: an API key id, or an OAuth client id. */
  readonly tokenId?: string | undefined;
  readonly label?: string | undefined;
  /** The role held at the time, frozen so a later demotion cannot rewrite it. */
  readonly role?: Role | undefined;
}

export type TAuditRecordInput<A extends TAuditAction = TAuditAction> = {
  readonly organizationId: string;
  readonly actor: TAuditActorRef;
  readonly source: TAuditLogSource;
  readonly action: A;
  /** Defaults to `allowed`; a refusal passes `denied` and a `denialReason`. */
  readonly outcome?: TAuditOutcome;
  readonly denialReason?: string;
  readonly affectedUserId?: string;
  readonly changes?: TAuditChanges;
  readonly metadata?: TAuditMetadata;
  readonly requestId?: string;
  readonly originIp?: string;
  readonly originCountry?: string;
  readonly userAgent?: string;
  /**
   * The resource acted on.
   *
   * Omitted for a resource the workspace has at most one of — the catalog
   * marks those `singleton: true`, and a stored id for one would be noise the
   * reader has to ignore. The rule is documented rather than typed: a
   * conditional property on the input does not survive the generic `record`
   * boundary without an assertion, and this is not an invariant a mistake can
   * corrupt. `resource_type` *is* derived, and that is enforced in three
   * places.
   */
  readonly resourceId?: string;
};

const REDACTED = "[redacted]";

/**
 * Field names a credential hides behind. A name match is coarse on purpose:
 * this is a backstop for the call site that forgets, not the rule. The catalog
 * documents what each action may put in `changes`, and a secret should never
 * reach it at all.
 */
const SECRET_FIELD =
  /(secret|token|password|passphrase|api[-_]?key|private[-_]?key|credential|hash|salt)/i;

const redactRecord = (values: TAuditMetadata): TAuditMetadata =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      SECRET_FIELD.test(key) ? REDACTED : value,
    ])
  );

/**
 * Top-level redaction of a diff. Nested objects are left alone: a diff is a
 * shallow map by contract (`AuditChanges`), and recursing into caller-provided
 * structure would guess at shapes this module does not own.
 */
export const redactAuditChanges = (changes: TAuditChanges): TAuditChanges => ({
  fields: [...changes.fields],
  before: redactRecord(changes.before),
  after: redactRecord(changes.after),
});

const toInsertRow = (
  input: TAuditRecordInput,
  id: string,
  occurredAt: Date
) => ({
  id,
  organizationId: input.organizationId,
  occurredAt,
  actorType: input.actor.type,
  actorUserId: input.actor.userId ?? null,
  actorTokenId: input.actor.tokenId ?? null,
  actorLabel: input.actor.label ?? null,
  actorRole: input.actor.role ?? null,
  affectedUserId: input.affectedUserId ?? null,
  source: input.source,
  action: input.action,
  outcome: input.outcome ?? "allowed",
  denialReason: input.denialReason ?? null,
  // Derived from the action, so the row's `resource_type` cannot disagree
  // with it and the check constraint has nothing to reject.
  resourceType: auditResourceTypeOf(input.action),
  resourceId: input.resourceId ?? null,
  changes:
    input.changes === undefined ? null : redactAuditChanges(input.changes),
  metadata: input.metadata === undefined ? null : redactRecord(input.metadata),
  requestId: input.requestId ?? null,
  originIp: input.originIp ?? null,
  originCountry: input.originCountry ?? null,
  userAgent: input.userAgent ?? null,
});

const makeAuditLogRecorder = Effect.gen(function* () {
  const repository = yield* AuditLogRepository;

  const recordEvent = Effect.fn("AuditLogRecorder.record")(function* (
    input: TAuditRecordInput
  ) {
    const enabled = yield* AuditLogEnabled;
    if (!enabled) {
      return;
    }
    const id = yield* AuditLogId.generate;
    const occurredAt = yield* DateTime.nowAsDate;
    yield* repository.insert(toInsertRow(input, id, occurredAt));
  });

  /**
   * Appends one entry, failing if it cannot be written.
   *
   * This is the form to use inside `transaction()`: a caught failure would not
   * un-abort the surrounding transaction, so swallowing here would turn a
   * refused insert into a confusing second error and a transaction that cannot
   * commit. The entry and the change it describes commit together, or neither
   * does.
   */
  const record = <A extends TAuditAction>(input: TAuditRecordInput<A>) =>
    recordEvent(input);

  /**
   * Appends one entry, or gives up quietly.
   *
   * For a write that is already durable and is not inside a transaction — a
   * provider callback, a best-effort attribution after an external call. The
   * action has happened; a missing audit row is a gap to alert on, not a reason
   * to fail the caller a second time.
   */
  const recordBestEffort = <A extends TAuditAction>(
    input: TAuditRecordInput<A>
  ) =>
    recordEvent(input).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Audit entry was not written").pipe(
          Effect.annotateLogs({
            action: input.action,
            organizationId: input.organizationId,
            error: String(error),
          })
        )
      )
    );

  return { record, recordBestEffort };
});

export class AuditLogRecorder extends Context.Service<AuditLogRecorder>()(
  "AuditLogRecorder",
  { make: makeAuditLogRecorder }
) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(AuditLogRepository.layer)
  );
}
