import { schema } from "@feeblo/db";
import { sql } from "drizzle-orm";

/**
 * Row locks that serialize a workspace-wide count-and-write pair.
 *
 * A condition that spans rows cannot be enforced by locking the rows it counts,
 * because a lookup that matches nothing proves nothing. The device this codebase
 * uses instead is to lock the one row that scopes the count — the workspace, or
 * the user a cross-workspace limit is counted for — for the caller's
 * transaction, and count inside it.
 *
 * ## Why `no key update`
 *
 * `no key update` and `update` conflict with themselves, which is the entire
 * serialization these callers need, but only `update` conflicts with the
 * key-share that inserting a row referencing the locked row takes. Every table
 * in a workspace references the organization, so `update` would make a post
 * create block every unrelated insert in that workspace — comments, upvotes,
 * invitations, uploads — for the length of its transaction, notification
 * fan-out included.
 *
 * The weaker lock also removes a rule rather than documenting one: under
 * `update`, a caller that inserted a child row before locking would deadlock
 * against another caller doing the same, because the insert's key-share
 * conflicts with the lock. Under `no key update` there is no conflict, so the
 * order is not load-bearing.
 *
 * `update` is still correct where blocking child inserts is the *point*; that is
 * the account-deletion membership re-check, which needs an invitation being
 * accepted to wait. `docs/adr/0020` records the whole decision.
 *
 * ## Lifetime
 *
 * Call these inside a transaction. Outside one the lock is released when the
 * statement ends, which serializes nothing and reads as if it did.
 */

/**
 * Locks a workspace's organization row until the caller's transaction ends.
 *
 * Serializes the per-workspace limits (feedback boards, changelog categories,
 * CRM entries, submission recipients, roadmap primaries) and the post-status
 * position sequence.
 */
export const lockOrganizationRow = (organizationId: string) =>
  sql`SELECT id FROM ${schema.organizationTable} WHERE id = ${organizationId} FOR NO KEY UPDATE`;

/**
 * Locks a user's row until the caller's transaction ends.
 *
 * The same device one scope up: a per-user cap counts rows across workspaces, so
 * no single workspace row can serialize it.
 */
export const lockUserRow = (userId: string) =>
  sql`SELECT id FROM ${schema.userTable} WHERE id = ${userId} FOR NO KEY UPDATE`;
