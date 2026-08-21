import * as S from "effect/Schema";

/**
 * Canonical asset-kind vocabulary.
 *
 * The `asset.kind` column is plain text (not a Postgres enum) so new asset
 * kinds don't require migrations; this Effect Schema is the single source of
 * truth.
 */
export const AssetKind = S.Literals([
  "profile_image",
  "organization_logo",
  "editor_image",
  "editor_video",
]);

export type TAssetKind = S.Schema.Type<typeof AssetKind>;
