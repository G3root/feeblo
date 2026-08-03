import { currentDb, schema } from "@feeblo/db";
import type { assetKindEnum } from "@feeblo/db/schema";
import { and, eq, inArray, like, not, or } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { extractAssetUrlsFromContent } from "./urls";

export type AssetKind = (typeof assetKindEnum.enumValues)[number];

export type AssetOwner =
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
    findByUrls: ({
      urls,
      organizationId,
    }: {
      readonly organizationId: string;
      readonly urls: readonly string[];
    }) =>
      urls.length === 0
        ? Effect.succeed([])
        : db
            .select()
            .from(schema.assetTable)
            .where(
              and(
                inArray(schema.assetTable.url, urls),
                eq(schema.assetTable.organizationId, organizationId),
                inArray(schema.assetTable.kind, [
                  "editor_image",
                  "editor_video",
                ])
              )
            ),
    findReferencedUrls: ({
      organizationId,
      urls,
      excludePostIds,
      excludeChangelogIds,
    }: {
      readonly organizationId: string;
      readonly urls: readonly string[];
      readonly excludePostIds: readonly string[];
      readonly excludeChangelogIds: readonly string[];
    }) =>
      Effect.gen(function* () {
        if (urls.length === 0) {
          return [];
        }

        const posts = yield* db
          .select({ content: schema.postTable.content })
          .from(schema.postTable)
          .where(
            and(
              eq(schema.postTable.organizationId, organizationId),
              or(
                ...urls.map((url) => like(schema.postTable.content, `%${url}%`))
              ),
              excludePostIds.length > 0
                ? not(inArray(schema.postTable.id, excludePostIds))
                : undefined
            )
          )
          .for("update");
        const changelogs = yield* db
          .select({ content: schema.changelogTable.content })
          .from(schema.changelogTable)
          .where(
            and(
              eq(schema.changelogTable.organizationId, organizationId),
              or(
                ...urls.map((url) =>
                  like(schema.changelogTable.content, `%${url}%`)
                )
              ),
              excludeChangelogIds.length > 0
                ? not(inArray(schema.changelogTable.id, excludeChangelogIds))
                : undefined
            )
          )
          .for("update");
        const comments = yield* db
          .select({ content: schema.commentTable.content })
          .from(schema.commentTable)
          .where(
            and(
              eq(schema.commentTable.organizationId, organizationId),
              or(
                ...urls.map((url) =>
                  like(schema.commentTable.content, `%${url}%`)
                )
              ),
              excludePostIds.length > 0
                ? not(inArray(schema.commentTable.postId, excludePostIds))
                : undefined
            )
          )
          .for("update");

        return [...posts, ...changelogs, ...comments].flatMap(({ content }) =>
          extractAssetUrlsFromContent(content)
        );
      }),
    deleteByIds: (ids: readonly string[]) =>
      ids.length === 0
        ? Effect.void
        : db
            .delete(schema.assetTable)
            .where(inArray(schema.assetTable.id, ids))
            .pipe(Effect.asVoid),
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
