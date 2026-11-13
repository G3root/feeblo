import { bigint, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { postTable } from "./feedback";

/**
 * One page view of a post, with the coarse dimensions the dashboard breaks
 * down.
 *
 * The row is a count with attributes, not a person: there is no IP address, no
 * user agent, and no visitor identifier. `country` comes from the edge
 * (`CF-IPCountry`); the rest are parsed from the user agent and the agent is
 * discarded. That is the whole privacy contract, and keeping it in the shape of
 * the table is what stops a later join from turning it into something else.
 *
 * `post_id` cascades: a deleted post takes its views with it, so erasure is a
 * database guarantee rather than a cleanup job somebody has to remember.
 */
export const postViewEventTable = pgTable(
  "post_view_event",
  {
    /** Client-generated idempotency key: a retried beacon is not a second view. */
    id: text("id").primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    postId: text("post_id")
      .notNull()
      .references(() => postTable.id, { onDelete: "cascade" }),
    /** ISO 3166-1 alpha-2, or "" when the edge did not say. */
    country: text("country").notNull().default(""),
    os: text("os").notNull().default(""),
    browser: text("browser").notNull().default(""),
    device: text("device").notNull().default(""),
  },
  (table) => [
    // The dashboard's per-post breakdowns: one post, one time window.
    index("post_view_event_postId_occurredAt_idx").on(
      table.postId,
      table.occurredAt
    ),
    // The retention pass filters on time alone, so it cannot use the
    // postId-led index above.
    index("post_view_event_occurredAt_idx").on(table.occurredAt),
  ]
);

/**
 * The all-time counter behind the number on a post.
 *
 * It exists because the events are pruned while the number is not: a card that
 * scanned `post_view_event` would forget every view older than the retention
 * window, and an all-time count is the one number a customer reads as a
 * cumulative fact. The events answer "from where", this answers "how many".
 */
export const postViewTotalTable = pgTable("post_view_total", {
  postId: text("post_id")
    .primaryKey()
    .references(() => postTable.id, { onDelete: "cascade" }),
  views: bigint("views", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
