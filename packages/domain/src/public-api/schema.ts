/**
 * The Public API's wire contract for v1, as one import surface.
 *
 * Each resource owns its own declarations (`./post/schema.ts`,
 * `./tag/schema.ts`, …) so an endpoint added to one resource does not edit a
 * shared file; this module re-exports them all for callers that want the whole
 * vocabulary at once. Import the resource module directly when only its
 * vocabulary is needed.
 *
 * The schemas are hand-written and closed. They deliberately do not reuse the
 * dashboard or public-portal response schemas: `PostListItem` carries
 * `creatorId` and `creatorMemberId`, which are internal actor identifiers the
 * portal nulls before responding, and a field added there must not silently
 * widen what an API key can read. Adding a field is therefore always two
 * edits — the DTO and its mapper — and is visible in review. See ADR 0004.
 */

export * from "./common";
export * from "../board/public-api/schema";
export * from "../changelog/public-api/schema";
export * from "../comments/public-api/schema";
export * from "../company/public-api/schema";
export * from "../post/public-api/schema";
export * from "../post-status/public-api/schema";
export * from "../tag/public-api/schema";
export * from "../upvote/public-api/schema";
