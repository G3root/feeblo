import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { HelpCenterEmbedder, HelpCenterEmbedding } from "./embedding";
import {
  HELP_CENTER_SEMANTIC_FILL_BELOW,
  HELP_CENTER_SEMANTIC_MAX_DISTANCE,
  makeHelpCenterSearch,
} from "./hybrid-search";

/**
 * The search program's own tests.
 *
 * They pin the contract the dashboard, the portal and the widget share: how
 * thin a lexical result has to be before the semantic pass runs, what order the
 * two halves land in, and that a model failure is a shorter answer rather than
 * a failed search. A lexical search and a semantic search stand in as plain
 * functions, so no database and no OpenAI client is involved; the surfaces'
 * own suites still drive the real repository.
 */

interface Hit {
  readonly id: string;
  readonly title: string;
}

const hit = (id: string): Hit => ({ id, title: id });

const hits = (...ids: string[]): readonly Hit[] => ids.map(hit);

/**
 * A lexical stand-in that answers with a fixed list and records its calls, so a
 * test can prove the semantic pass was skipped rather than merely unobservable.
 */
const lexicalReturning = (rows: readonly Hit[] = []) => {
  const calls: {
    readonly includeUnreadable: boolean;
    readonly limit: number;
  }[] = [];

  const lexical = (args: {
    readonly includeUnreadable: boolean;
    readonly limit: number;
  }) => {
    calls.push({
      includeUnreadable: args.includeUnreadable,
      limit: args.limit,
    });

    return Effect.succeed(rows);
  };

  return { calls, lexical };
};

/**
 * A semantic stand-in keyed by distance, ordered the way the repository orders.
 *
 * Callers name an id and a distance; the title is filled in so a row satisfies
 * the same `Hit` the lexical half returns, which is what makes the merge
 * meaningful.
 */
const semanticReturning = (
  rows: readonly { readonly distance: number | null; readonly id: string }[]
) => {
  let calls = 0;

  const semantic = () => {
    calls += 1;

    return Effect.succeed(rows.map((row) => ({ ...row, title: row.id })));
  };

  return { calls: () => calls, semantic };
};

/** An embedder that answers a fixed model and vector, and counts its calls. */
const embedderAnswering = (
  answer: Option.Option<HelpCenterEmbedding> = Option.some({
    model: "test-embedding",
    vector: [0.1, 0.2],
  })
) => {
  let calls = 0;

  const embedder: HelpCenterEmbedder = {
    embed: () => {
      calls += 1;

      return Effect.succeed(answer);
    },
  };

  return { calls: () => calls, embedder };
};

const searchWith = (deps: {
  readonly embeddings: Option.Option<HelpCenterEmbedder>;
  readonly lexical: ReturnType<typeof lexicalReturning>["lexical"];
  readonly semantic: ReturnType<typeof semanticReturning>["semantic"];
}) => makeHelpCenterSearch<Hit, never, never>(deps);

it.effect(
  "answers lexically and never embeds when the words already found enough",
  () =>
    Effect.gen(function* () {
      const lexical = lexicalReturning(
        hits("a", "b", "c").slice(0, HELP_CENTER_SEMANTIC_FILL_BELOW)
      );

      const semantic = semanticReturning([]);
      const embedder = embedderAnswering();

      const search = searchWith({
        embeddings: Option.some(embedder.embedder),
        lexical: lexical.lexical,
        semantic: semantic.semantic,
      });

      const results = yield* search({
        includeUnreadable: false,
        organizationId: "org",
        query: "export",
      });

      expect(results.map((row) => row.id)).toStrictEqual(["a", "b", "c"]);
      // The point of the threshold: a search that answered costs nothing.
      expect(embedder.calls()).toBe(0);
      expect(semantic.calls()).toBe(0);
    })
);

it.effect("fills the tail from the semantic pass, after the lexical hits", () =>
  Effect.gen(function* () {
    const lexical = lexicalReturning(hits("exact"));

    const semantic = semanticReturning([
      { distance: HELP_CENTER_SEMANTIC_MAX_DISTANCE / 2, id: "near" },
      // Already returned lexically: an exact match is also a near vector.
      { distance: 0.01, id: "exact" },
      { distance: HELP_CENTER_SEMANTIC_MAX_DISTANCE / 3, id: "nearer" },
    ]);

    const embedder = embedderAnswering();

    const results = yield* searchWith({
      embeddings: Option.some(embedder.embedder),
      lexical: lexical.lexical,
      semantic: semantic.semantic,
    })({
      includeUnreadable: false,
      organizationId: "org",
      query: "export csv",
    });

    // Exact-word evidence keeps its precedence; the near-misses fill behind it,
    // in the repository's distance order, without repeating the exact hit.
    expect(results.map((row) => row.id)).toStrictEqual([
      "exact",
      "near",
      "nearer",
    ]);
    expect(embedder.calls()).toBe(1);
  })
);

it.effect("drops a semantic hit that is too far away", () =>
  Effect.gen(function* () {
    const embedder = embedderAnswering();

    const results = yield* searchWith({
      embeddings: Option.some(embedder.embedder),
      lexical: lexicalReturning([]).lexical,
      semantic: semanticReturning([
        { distance: HELP_CENTER_SEMANTIC_MAX_DISTANCE + 0.01, id: "far" },
        { distance: null, id: "unembedded" },
      ]).semantic,
    })({ includeUnreadable: false, organizationId: "org", query: "export" });

    // A page the model could not score, and one it scored as unrelated, are
    // not answers.
    expect(results).toStrictEqual([]);
  })
);

it.effect("never returns more than the caller asked for", () =>
  Effect.gen(function* () {
    const embedder = embedderAnswering();

    const results = yield* searchWith({
      embeddings: Option.some(embedder.embedder),
      lexical: lexicalReturning(hits("exact")).lexical,
      semantic: semanticReturning([
        { distance: 0.1, id: "one" },
        { distance: 0.2, id: "two" },
        { distance: 0.3, id: "three" },
      ]).semantic,
    })({
      includeUnreadable: false,
      limit: 2,
      organizationId: "org",
      query: "export",
    });

    expect(results.map((row) => row.id)).toStrictEqual(["exact", "one"]);
  })
);

it.effect("answers lexically when the model answers nothing", () =>
  Effect.gen(function* () {
    // What the adapter produces when the provider is down: no embedding, no
    // error. The program cannot tell this apart from a deployment with no key.
    const results = yield* searchWith({
      embeddings: Option.some(embedderAnswering(Option.none()).embedder),
      lexical: lexicalReturning(hits("exact")).lexical,
      semantic: semanticReturning([{ distance: 0.1, id: "near" }]).semantic,
    })({ includeUnreadable: false, organizationId: "org", query: "export" });

    // The reader gets the answer they would have got without a model rather
    // than an error page.
    expect(results.map((row) => row.id)).toStrictEqual(["exact"]);
  })
);

it.effect("answers lexically when the deployment has no key", () =>
  Effect.gen(function* () {
    const lexical = lexicalReturning([]);

    const results = yield* searchWith({
      embeddings: Option.none(),
      lexical: lexical.lexical,
      semantic: semanticReturning([{ distance: 0.1, id: "near" }]).semantic,
    })({ includeUnreadable: false, organizationId: "org", query: "export" });

    expect(results).toStrictEqual([]);
    expect(lexical.calls).toHaveLength(1);
  })
);

it.effect("does not embed for a strict search, even with no hits", () =>
  Effect.gen(function* () {
    const embedder = embedderAnswering();
    const semantic = semanticReturning([{ distance: 0.1, id: "near" }]);

    const results = yield* searchWith({
      embeddings: Option.some(embedder.embedder),
      lexical: lexicalReturning([]).lexical,
      semantic: semantic.semantic,
    })({
      includeUnreadable: false,
      organizationId: "org",
      query: "export",
      strict: true,
    });

    // A strict search exists to show a page that shares the visitor's words; a
    // semantic neighbour with no word overlap is the suggestion that looks like
    // a mistake beside a feedback form.
    expect(results).toStrictEqual([]);
    expect(embedder.calls()).toBe(0);
    expect(semantic.calls()).toBe(0);
  })
);

it.effect("does not embed an empty query", () =>
  Effect.gen(function* () {
    const embedder = embedderAnswering();

    yield* searchWith({
      embeddings: Option.some(embedder.embedder),
      lexical: lexicalReturning([]).lexical,
      semantic: semanticReturning([]).semantic,
    })({ includeUnreadable: false, organizationId: "org", query: "   " });

    expect(embedder.calls()).toBe(0);
  })
);
