import * as S from "effect/Schema";

/**
 * The import sources this deployment can pull posts from.
 *
 * A provider id is the only thing the start RPC accepts, so the dashboard
 * never learns a provider's request shape. Adding a provider is an adapter
 * and a descriptor; the RPC, the credential form and the staged-job pipeline
 * stay as they are. The id is also stored nowhere: a provider job is
 * identified by its file name ("Canny import") and its fingerprint, because a
 * source column would be a migration for a label the report already carries.
 */
export const DATA_IMPORT_PROVIDER_IDS = [
  "canny",
  "nolt",
  "productboard",
] as const;

export const DataImportProviderId = S.Literals(DATA_IMPORT_PROVIDER_IDS);

export type TDataImportProviderId = S.Schema.Type<typeof DataImportProviderId>;

/**
 * One credential a provider needs, described for a generic form.
 *
 * The dashboard renders one input per field and sends the values back as a
 * keyed record, so a provider that later needs an account URL or a second
 * token does not change the web app. `secret` only controls the input's
 * masking; every credential value is discarded after the fetch.
 */
export const DataImportProviderCredentialField = S.Struct({
  key: S.String,
  label: S.String,
  placeholder: S.String,
  description: S.String,
  secret: S.Boolean,
});

export type TDataImportProviderCredentialField = S.Schema.Type<
  typeof DataImportProviderCredentialField
>;

/**
 * What a provider brings across, in the words the card shows.
 *
 * The list is data rather than copy in the web app so a provider's promise
 * and its adapter are maintained in one place. `omissions` is its inverse and
 * is equally part of the contract: an import is create-only, and saying what
 * cannot cross before the credential is used is cheaper than the support
 * question after.
 */
export const DataImportProviderDescriptor = S.Struct({
  id: DataImportProviderId,
  name: S.String,
  tagline: S.String,
  /** What the import carries, as short chips on the source card. */
  carries: S.Array(S.String),
  /** The credential fields the credential form renders, in display order. */
  credentialFields: S.Array(DataImportProviderCredentialField),
  helpText: S.String,
  helpUrl: S.String,
  omissions: S.Array(S.String),
});

export type TDataImportProviderDescriptor = S.Schema.Type<
  typeof DataImportProviderDescriptor
>;
