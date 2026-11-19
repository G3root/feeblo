import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type { ParsedBoardPostRow } from "./csv";
import type {
  DataImportProviderError,
  DataImportRowLimitError,
} from "./errors";
import type {
  TDataImportProviderDescriptor,
  TDataImportProviderId,
} from "./provider-schema";

/**
 * The credentials a provider needs, after the dashboard's form is submitted.
 *
 * A record rather than a typed per-provider struct so the RPC and the form do
 * not grow a variant per provider. Each adapter validates the keys its own
 * descriptor declares and ignores the rest.
 */
export type ImportProviderCredentials = Readonly<Record<string, string>>;

/**
 * Everything one fetch returned, before anything is staged.
 *
 * `rows` use the CSV parser's row shape on purpose: planning, status and board
 * resolution, warnings, the row report and the worker are one pipeline, and a
 * provider is only another way to produce its input. `fingerprint` is a stable
 * identity for the fetched set (the provider's own post ids), which the
 * service hashes so the existing "already imported" warning works without a
 * second column or a migration.
 */
export type ProviderImportResult = {
  readonly rows: readonly ParsedBoardPostRow[];
  readonly fingerprint: string;
  /** Provider-level notes shown on the review page; never personal data. */
  readonly notices: readonly string[];
};

/**
 * One import source. An adapter owns its transport, pagination, status
 * mapping and error vocabulary; it must do no database work, because the
 * service fetches before it stages and a transaction must never wrap a
 * provider request.
 */
export type ImportProviderAdapter = {
  readonly descriptor: TDataImportProviderDescriptor;
  readonly fetchPosts: (input: {
    readonly credentials: ImportProviderCredentials;
  }) => Effect.Effect<
    ProviderImportResult,
    DataImportProviderError | DataImportRowLimitError
  >;
};

export type ImportProviderDirectory = {
  readonly list: () => readonly TDataImportProviderDescriptor[];
  readonly find: (
    id: TDataImportProviderId
  ) => Option.Option<ImportProviderAdapter>;
};

/**
 * The adapters this deployment can pull from, keyed by the id the RPC names.
 *
 * The registry is a service rather than a literal import so the service has
 * one dependency instead of every adapter's transport. The composition root
 * supplies it from `providers/index.ts`, and a test supplies a fake adapter
 * without touching a real provider client.
 */
export class ImportProviderRegistry extends Context.Service<
  ImportProviderRegistry,
  ImportProviderDirectory
>()("ImportProviderRegistry") {}

/** Builds the registry from its adapters; the last adapter wins on a duplicate id. */
export const makeImportProviderRegistry = (
  adapters: readonly ImportProviderAdapter[]
): ImportProviderDirectory => {
  const byId = new Map(
    adapters.map((adapter) => [adapter.descriptor.id, adapter] as const)
  );

  return {
    find: (id) => Option.fromNullishOr(byId.get(id)),
    list: () => adapters.map((adapter) => adapter.descriptor),
  };
};

/** A registry layer for a fixed adapter list, used by the composition root. */
export const makeImportProviderRegistryLayer = (
  adapters: readonly ImportProviderAdapter[]
): Layer.Layer<ImportProviderRegistry> =>
  Layer.sync(ImportProviderRegistry, () =>
    makeImportProviderRegistry(adapters)
  );
