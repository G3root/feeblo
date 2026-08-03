import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organizationTable, userTable } from "./auth";

export const assetKindEnum = pgEnum("asset_kind", [
  "profile_image",
  "organization_logo",
  "editor_image",
  "editor_video",
]);

export const assetTable = pgTable(
  "asset",
  {
    id: text("id").primaryKey(),
    bucket: text("bucket").notNull(),
    key: text("key").notNull(),
    url: text("url").notNull(),
    kind: assetKindEnum("kind").notNull(),
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
    index("asset_userId_idx").on(table.userId),
    index("asset_organizationId_idx").on(table.organizationId),
    index("asset_url_idx").on(table.url),
  ]
);

export const assetDeletionTable = pgTable(
  "asset_deletion",
  {
    id: text("id").primaryKey(),
    bucket: text("bucket").notNull(),
    key: text("key").notNull(),
    error: text("error").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("asset_deletion_bucket_key_uidx").on(table.bucket, table.key),
  ]
);

export type Asset = typeof assetTable.$inferSelect;
export type NewAsset = typeof assetTable.$inferInsert;
export type AssetDeletion = typeof assetDeletionTable.$inferSelect;
