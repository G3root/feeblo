import { PostStatusType } from "@feeblo/domain-contracts/post-status-type";
import * as Schema from "effect/Schema";

/**
 * The status resource: the workspace's status catalog, and the typed input the
 * one status operation takes.
 *
 * Declared separately from the status embedded in a post payload rather than as
 * a widening of it, so adding a field here cannot silently change every post
 * response: a post carries `{ id, name, type }`, while this resource carries
 * the fields a caller needs to render a status picker — its display order and
 * its color. See `docs/adr/0004`.
 */

/**
 * One status of the workspace.
 *
 * `name` is the label with the same empty-label fallback a post's embedded
 * status uses, so the same status cannot be called two things across endpoints.
 * The workspace is not named: a key reads exactly one workspace, so the field
 * would be the same string on every response.
 */
export const PublicApiStatusDetail = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: PostStatusType,
  orderIndex: Schema.Finite,
  color: Schema.NullOr(Schema.String),
});

export type TPublicApiStatusDetail = Schema.Schema.Type<
  typeof PublicApiStatusDetail
>;

/**
 * The whole catalog, in display order.
 *
 * Not a page: a workspace has a handful of statuses, they are read by their
 * `orderIndex` rather than by age, and a cursor that paged them by creation
 * time would order them differently from the way the dashboard and portal
 * render them.
 */
export const PublicApiStatusList = Schema.Struct({
  data: Schema.Array(PublicApiStatusDetail),
});

export type TPublicApiStatusList = Schema.Schema.Type<
  typeof PublicApiStatusList
>;

/**
 * Typed input for reading the workspace's statuses: nothing to name.
 *
 * A record with a `never` value type rather than `Schema.Struct({})`: an empty
 * struct's JSON Schema is `{ not: { type: "null" } }`, which the MCP transport
 * rejects because a tool's `inputSchema` must be an object schema, while the
 * record compiles to `{ type: "object", additionalProperties: false }`. This
 * is the shape the AI toolkit's own `EmptyParams` uses, restated here so the
 * schema does not depend on the AI surface.
 */
export const ListStatusesInput = Schema.Record(Schema.String, Schema.Never);
