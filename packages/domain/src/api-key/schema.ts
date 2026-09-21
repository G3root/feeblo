import { WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

/**
 * Key metadata as the dashboard shows it. It never carries the key itself —
 * only `start`, the characters stored for identification.
 */
export const ApiKeySummary = S.Struct({
  id: S.String,
  name: S.NullOr(S.String),
  /** First characters of the key, e.g. `fbk_ab`. */
  start: S.NullOr(S.String),
  prefix: S.NullOr(S.String),
  enabled: S.Boolean,
  scopes: S.Array(S.String),
  createdAt: S.DateFromString,
  lastRequest: S.NullOr(S.DateFromString),
  expiresAt: S.NullOr(S.DateFromString),
});

export type TApiKeySummary = S.Schema.Type<typeof ApiKeySummary>;

/** Result of creating a key: the plaintext appears here and nowhere else. */
export const ApiKeyCreated = S.Struct({
  key: S.String,
  summary: ApiKeySummary,
});

export type TApiKeyCreated = S.Schema.Type<typeof ApiKeyCreated>;

export const ApiKeyCreate = S.Struct({
  organizationId: WorkspaceId.schema,
  name: S.String.check(S.isLengthBetween(1, 32)),
});

export type TApiKeyCreate = S.Schema.Type<typeof ApiKeyCreate>;

export const ApiKeyList = S.Struct({
  organizationId: WorkspaceId.schema,
});

export type TApiKeyList = S.Schema.Type<typeof ApiKeyList>;

export const ApiKeyRevoke = S.Struct({
  organizationId: WorkspaceId.schema,
  keyId: S.String,
});

export type TApiKeyRevoke = S.Schema.Type<typeof ApiKeyRevoke>;

/**
 * The narrower key record the `Auth` service exposes to domain code.
 *
 * `@feeblo/domain` deliberately does not depend on `@better-auth/api-key`, so
 * the plugin's key shape is restated here as the seam's contract. The plugin
 * returns a superset of these fields; only the fields the dashboard renders
 * are named.
 */
export type ApiKeyAuthRecord = {
  readonly id: string;
  readonly name: string | null;
  readonly start: string | null;
  readonly prefix: string | null;
  readonly enabled: boolean;
  readonly createdAt: Date;
  readonly lastRequest: Date | null;
  readonly expiresAt: Date | null;
  /**
   * Owning entity. For the Public API this is always an organization id: keys
   * are organization-owned, and the plugin enforces that through the ACL.
   */
  readonly referenceId: string;
  readonly permissions?:
    | { readonly [resource: string]: readonly string[] }
    | null
    | undefined;
};

/** A key record plus its plaintext value, returned only by key creation. */
export type ApiKeyAuthCreated = ApiKeyAuthRecord & {
  readonly key: string;
};
