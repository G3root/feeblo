import { currentDb, schema } from "@feeblo/db";
import { and, eq, inArray } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

type AssetKind =
  | "profile_image"
  | "organization_logo"
  | "editor_image"
  | "editor_video";

type AssetOwner =
  | { readonly type: "organization"; readonly id: string }
  | { readonly type: "user"; readonly id: string };

const makeAssetRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  return {
    findByOwnerAndKind: ({
      kind,
      owner,
    }: {
      readonly kind: AssetKind;
      readonly owner: AssetOwner;
    }) =>
      db
        .select()
        .from(schema.assetTable)
        .where(
          and(
            eq(schema.assetTable.kind, kind),
            owner.type === "user"
              ? eq(schema.assetTable.userId, owner.id)
              : eq(schema.assetTable.organizationId, owner.id)
          )
        ),
    findByUrls: (urls: readonly string[]) =>
      urls.length === 0
        ? Effect.succeed([])
        : db
            .select()
            .from(schema.assetTable)
            .where(inArray(schema.assetTable.url, urls)),
    deleteByIds: (ids: readonly string[]) =>
      ids.length === 0
        ? Effect.succeed([])
        : db
            .delete(schema.assetTable)
            .where(inArray(schema.assetTable.id, ids)),
  };
});

export class AssetRepository extends Context.Service<AssetRepository>()(
  "AssetRepository",
  {
    make: makeAssetRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
