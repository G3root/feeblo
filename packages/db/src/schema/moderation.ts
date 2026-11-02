import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { memberTable, organizationTable, userTable } from "./auth";

/**
 * A workspace-scoped decision that one end user may not participate in that
 * workspace's public surfaces.
 *
 * The row is keyed by the account (`user_id`) and/or the normalized address
 * (`email`). Both facets are optional because the same person can arrive either
 * way: a portal user has an account, a widget SSO submission can be checked by
 * address, and an admin may block an address before it ever signs up. At least
 * one facet is required, and each facet has its own partial unique index so one
 * person cannot accumulate duplicate blocks.
 *
 * The row is not `user.banned`: that column is a better-auth login ban and
 * would stop the person reading every workspace. It is not
 * `email_suppression` either: a block is about participation, not
 * deliverability, and must not stop account mail.
 *
 * `user_id` is `set null` on account deletion and `email` is copied at block
 * time, so a block by address survives the account it was created from. The
 * workspace cascades, because the block has no meaning outside its workspace.
 */
export const userBlockTable = pgTable(
  "user_block",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => userTable.id, {
      onDelete: "set null",
    }),
    /** Normalized (trimmed, lowercased) before it reaches this column. */
    email: text("email"),
    /** Internal operator context; never shown to the blocked end user. */
    reason: text("reason"),
    createdByMemberId: text("created_by_member_id").references(
      () => memberTable.id,
      { onDelete: "set null" }
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
    uniqueIndex("user_block_organizationId_userId_uidx")
      .on(table.organizationId, table.userId)
      .where(sql`${table.userId} is not null`),
    uniqueIndex("user_block_organizationId_email_uidx")
      .on(table.organizationId, table.email)
      .where(sql`${table.email} is not null`),
    index("user_block_organizationId_createdAt_idx").on(
      table.organizationId,
      table.createdAt
    ),
    check(
      "user_block_subject_chk",
      sql`${table.userId} is not null or ${table.email} is not null`
    ),
    check(
      "user_block_email_normalized_chk",
      sql`${table.email} is null or ${table.email} = lower(btrim(${table.email}))`
    ),
    check(
      "user_block_reason_chk",
      sql`${table.reason} is null or (length(${table.reason}) between 1 and 500)`
    ),
  ]
);
