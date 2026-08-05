import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { TAssetKind } from "../validation-schema/asset-kind";
import { organizationTable, userTable } from "./auth";
import { changelogTable, postTable } from "./feedback";

export const assetTable = pgTable(
  "asset",
  {
    id: text("id").primaryKey(),
    bucket: text("bucket").notNull(),
    key: text("key").notNull(),
    url: text("url").notNull(),
    kind: text("kind").$type<TAssetKind>().notNull(),
    userId: text("user_id").references(() => userTable.id, {
      onDelete: "cascade",
    }),
    organizationId: text("organization_id").references(
      () => organizationTable.id,
      { onDelete: "cascade" }
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    check(
      "asset_owner_check",
      sql`(${table.userId} IS NOT NULL) <> (${table.organizationId} IS NOT NULL)`
    ),
    uniqueIndex("asset_key_uidx").on(table.bucket, table.key),
    uniqueIndex("asset_owner_kind_singleton_uidx")
      .on(sql`COALESCE(${table.userId}, ${table.organizationId})`, table.kind)
      .where(sql`${table.kind} IN ('profile_image', 'organization_logo')`),
    index("asset_userId_idx").on(table.userId),
    index("asset_organizationId_idx").on(table.organizationId),
    index("asset_url_idx").on(table.url),
  ]
);

export const postAssetTable = pgTable(
  "post_asset",
  {
    postId: text("post_id")
      .notNull()
      .references(() => postTable.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assetTable.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.assetId] }),
    index("post_asset_assetId_idx").on(table.assetId),
  ]
);

export const changelogAssetTable = pgTable(
  "changelog_asset",
  {
    changelogId: text("changelog_id")
      .notNull()
      .references(() => changelogTable.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assetTable.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.changelogId, table.assetId] }),
    index("changelog_asset_assetId_idx").on(table.assetId),
  ]
);

export type Asset = typeof assetTable.$inferSelect;
export type NewAsset = typeof assetTable.$inferInsert;
