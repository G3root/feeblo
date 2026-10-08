import { expect, it } from "@effect/vitest";
import { asLegid, BoardId, WorkspaceId } from "@feeblo/id";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  DEFAULT_POST_EMBEDDING_MODEL,
  InvalidPostEmbeddingDimensionsError,
  type PostEmbeddingService,
} from "./embedding-service";
import type { TPostSuggestionCandidates } from "./repository";
import { makePostSuggestions, SUGGESTION_MAX_DISTANCE } from "./suggestions";

/**
 * The suggestion program's own tests.
 *
 * They exercise the interface both surfaces call — the semantic pass, the
 * lexical fallback, and the candidate limits — with a candidate query and an
 * embedder as the only collaborators, so no database and no OpenAI client are
 * involved. The dashboard and widget suites still drive their surfaces; these
 * pin the ranking contract the two now share.
 */

const organizationId = asLegid(WorkspaceId)("org_suggestions");
const boardId = asLegid(BoardId)("brd_suggestions");

const createdAt = DateTime.toDateUtc(
  DateTime.makeUnsafe("2026-01-01T00:00:00Z")
);

/** A repository candidate row with every projected field present. */
interface CandidateRow {
  readonly archivedAt: Date | null;
  readonly authorIsMember: boolean;
  readonly boardId: string;
  readonly content: string;
  readonly createdAt: Date;
  readonly creatorId: string | null;
  readonly creatorMemberId: string | null;
  readonly distance: number | null;
  readonly etaQuarter: string | null;
  readonly excerpt: string;
  readonly id: string;
  readonly lockedAt: Date | null;
  readonly mergedAt: Date | null;
  readonly mergedIntoPostId: string | null;
  readonly metadata: Record<string, string>;
  readonly organizationId: string;
  readonly slug: string;
  readonly statusId: string;
  readonly title: string;
  readonly updatedAt: Date;
  readonly user: {
    readonly image: string | null;
    readonly name: string | null;
  };
}

const candidate = (row: {
  readonly content: string;
  readonly distance?: number | null;
  readonly id: string;
  readonly title: string;
}): CandidateRow => ({
  archivedAt: null,
  authorIsMember: false,
  boardId,
  content: row.content,
  createdAt,
  creatorId: null,
  creatorMemberId: null,
  distance: row.distance ?? null,
  etaQuarter: null,
  excerpt: row.content.slice(0, 32),
  id: row.id,
  lockedAt: null,
  mergedAt: null,
  mergedIntoPostId: null,
  metadata: {},
  organizationId,
  slug: row.id,
  statusId: "pst_suggestions",
  title: row.title,
  updatedAt: createdAt,
  user: { image: null, name: null },
});

/**
 * A recording candidate query.
 *
 * The responder receives the call index so a test can answer the semantic
 * pass and the lexical fallback with different rows, which is exactly the
 * round trip the program makes in production.
 */
const makeCandidates = (
  respond: (
    args: TPostSuggestionCandidates,
    call: number
  ) => readonly CandidateRow[]
) => {
  const calls: TPostSuggestionCandidates[] = [];
  const candidates = (
    args: TPostSuggestionCandidates
  ): Effect.Effect<readonly CandidateRow[]> => {
    const call = calls.length;
    calls.push(args);
    return Effect.succeed([...respond(args, call)]);
  };
  return { calls, candidates };
};

const semanticEmbeddings = (
  vector: readonly number[]
): Option.Option<PostEmbeddingService["Service"]> =>
  Option.some({
    embed: () =>
      Effect.succeed(
        Option.some({ model: DEFAULT_POST_EMBEDDING_MODEL, vector })
      ),
  });

it.effect(
  "returns the near candidates from the semantic pass and asks for the result limit",
  () =>
    Effect.gen(function* () {
      const near = candidate({
        content: "Export reports as CSV",
        distance: SUGGESTION_MAX_DISTANCE / 2,
        id: "post_near",
        title: "Export reports",
      });
      const far = candidate({
        content: "Use a darker theme",
        distance: SUGGESTION_MAX_DISTANCE + 0.1,
        id: "post_far",
        title: "Dark mode",
      });
      const { calls, candidates } = makeCandidates(() => [near, far]);
      const search = makePostSuggestions({
        candidates,
        embeddings: semanticEmbeddings([1, 0]),
      });

      const suggestions = yield* search({
        boardId,
        content: "CSV export",
        limit: 3,
        organizationId,
        publicOnly: false,
        title: "Export",
      });

      expect(suggestions.map(({ id }) => id)).toEqual(["post_near"]);
      // The semantic pass is the only query when it answers.
      expect(calls).toHaveLength(1);
      expect(calls[0]?.limit).toBe(3);
      expect(calls[0]?.embedding).toEqual([1, 0]);
      expect(calls[0]?.embeddingModel).toBe(DEFAULT_POST_EMBEDDING_MODEL);
      expect(calls[0]?.publicOnly).toBe(false);
      // The query's ordering column is not part of the published row.
      expect(Object.keys(suggestions[0] ?? {})).not.toContain("distance");
    })
);

it.effect("ranks lexically without embeddings and keeps the pool floor", () =>
  Effect.gen(function* () {
    const billing = candidate({
      content: "Please support annual subscription invoices",
      id: "post_billing",
      title: "Add yearly billing",
    });
    const unrelated = candidate({
      content: "Use a darker color theme",
      id: "post_dark",
      title: "Dark mode",
    });
    const { calls, candidates } = makeCandidates(() => [billing, unrelated]);
    const search = makePostSuggestions({
      candidates,
      embeddings: Option.none(),
    });

    const suggestions = yield* search({
      boardId,
      content: "Yearly subscription invoices",
      limit: 1,
      organizationId,
      publicOnly: true,
      title: "Annual billing",
    });

    expect(suggestions.map(({ id }) => id)).toEqual(["post_billing"]);
    // One lexical query, and the pool is the constant floor at this limit.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.limit).toBe(25);
    expect(calls[0]?.embedding).toBeUndefined();
    expect(calls[0]?.publicOnly).toBe(true);
  })
);

it.effect(
  "falls back to lexical ranking when no semantic candidate is close enough, scaling the pool with the limit",
  () =>
    Effect.gen(function* () {
      const far = candidate({
        content: "Use a darker color theme",
        distance: SUGGESTION_MAX_DISTANCE + 0.1,
        id: "post_far",
        title: "Dark mode",
      });
      const billing = candidate({
        content: "Please support annual subscription invoices",
        id: "post_billing",
        title: "Add yearly billing",
      });
      const invoices = candidate({
        content: "Invoice history for annual subscriptions",
        id: "post_invoices",
        title: "Billing invoice history",
      });
      const { calls, candidates } = makeCandidates((_args, call) =>
        call === 0 ? [far] : [billing, invoices]
      );
      const search = makePostSuggestions({
        candidates,
        embeddings: semanticEmbeddings([1, 0]),
      });

      const suggestions = yield* search({
        boardId,
        content: "Annual subscription invoices",
        limit: 20,
        organizationId,
        publicOnly: false,
        title: "Billing",
      });

      expect(suggestions).toHaveLength(2);
      expect(calls).toHaveLength(2);
      // The semantic pass asks for the result limit; the lexical fallback
      // asks for the scaled pool.
      expect(calls[0]?.limit).toBe(20);
      expect(calls[1]?.limit).toBe(100);
      expect(calls[1]?.embedding).toBeUndefined();
    })
);

it.effect("logs a failed embedding and still answers lexically", () =>
  Effect.gen(function* () {
    const billing = candidate({
      content: "Please support annual subscription invoices",
      id: "post_billing",
      title: "Add yearly billing",
    });
    const { calls, candidates } = makeCandidates(() => [billing]);
    const search = makePostSuggestions({
      candidates,
      embeddings: Option.some({
        embed: () =>
          Effect.fail(
            new InvalidPostEmbeddingDimensionsError({
              actual: 1,
              expected: 2,
            })
          ),
      }),
    });

    const suggestions = yield* search({
      boardId,
      content: "Annual billing",
      organizationId,
      publicOnly: false,
      title: "Yearly subscription invoices",
    });

    expect(suggestions.map(({ id }) => id)).toEqual(["post_billing"]);
    // A failed embedding leaves nothing to query semantically, so the
    // fallback pool is the only query.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.limit).toBe(25);
  })
);
