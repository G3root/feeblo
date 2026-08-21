import * as S from "effect/Schema";

/**
 * Canonical roadmap-mode vocabulary.
 *
 * The `roadmap.mode` column is plain text (not a Postgres enum) so new modes
 * don't require migrations; this Effect Schema is the single source of truth.
 */
export const RoadmapMode = S.Literals(["status", "filtered"]);

export type TRoadmapMode = S.Schema.Type<typeof RoadmapMode>;
