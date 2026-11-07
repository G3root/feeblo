import { describe, expect, it } from "vitest";

import type { WidgetSuggestion } from "../../lib/api";
import {
  initialSuggestionSearchState,
  isSuggestionSearchPending,
  reduceSuggestionSearch,
  type SuggestionQuery,
  type SuggestionSearchEvent,
  type SuggestionSearchState,
} from "./suggestion-search";

/**
 * The reducer is the whole graph, so these tests walk it event by event. The
 * driver in `create-suggestion-search.ts` adds only a timer and an abort
 * controller; every decision — including the staleness guard — is here.
 */

const QUERY: SuggestionQuery = {
  boardId: "brd_1",
  content: "the export button is missing",
  title: "Export is missing",
};

const suggestion = (id: string): WidgetSuggestion => ({
  excerpt: "excerpt",
  id,
  slug: `post-${id}`,
  title: `Post ${id}`,
});

const settle = (
  events: readonly SuggestionSearchEvent[],
  state: SuggestionSearchState = initialSuggestionSearchState
) => events.reduce(reduceSuggestionSearch, state);

const loaded = (...ids: string[]): SuggestionSearchEvent => ({
  suggestions: ids.map(suggestion),
  type: "LOADED",
});

const ids = (state: SuggestionSearchState) =>
  state.suggestions.map((entry) => entry.id);

describe("suggestion search reducer", () => {
  it("starts idle with nothing to show", () => {
    expect(initialSuggestionSearchState).toStrictEqual({
      suggestions: [],
      status: "idle",
    });
  });

  it("clears the panel when the title is too short to ask about", () => {
    const state = settle([
      { query: QUERY, type: "INPUT" },
      { type: "DEBOUNCED" },
      loaded("a"),
      { query: null, type: "INPUT" },
    ]);

    expect(state).toStrictEqual({ suggestions: [], status: "idle" });
  });

  it("keeps the last result visible while a newer query is pending", () => {
    // The flash this removes: the panel used to empty on every keystroke.
    const settled = settle([
      { query: QUERY, type: "INPUT" },
      { type: "DEBOUNCED" },
      loaded("a", "b"),
    ]);

    const debouncing = reduceSuggestionSearch(settled, {
      query: { ...QUERY, title: "Export is missing " },
      type: "INPUT",
    });
    expect(ids(debouncing)).toStrictEqual(["a", "b"]);
    expect(debouncing.status).toBe("debouncing");

    const loading = reduceSuggestionSearch(debouncing, { type: "DEBOUNCED" });
    expect(ids(loading)).toStrictEqual(["a", "b"]);
    expect(loading.status).toBe("loading");
  });

  it("settles on the answer to the query that is in flight", () => {
    const state = settle([
      { query: QUERY, type: "INPUT" },
      { type: "DEBOUNCED" },
      loaded("a", "b"),
    ]);

    expect(state.status).toBe("ready");
    expect(ids(state)).toStrictEqual(["a", "b"]);
  });

  it("drops an answer that arrives after the query changed", () => {
    // The `isCurrent` flag this replaces. Once `INPUT` has moved the state to
    // `debouncing`, `LOADED` has no transition to take, so a superseded
    // response cannot be rendered even if the abort did not reach the network.
    const inFlight = settle([
      { query: QUERY, type: "INPUT" },
      { type: "DEBOUNCED" },
    ]);

    const afterChange = reduceSuggestionSearch(inFlight, {
      query: { ...QUERY, content: "different" },
      type: "INPUT",
    });
    const stale = reduceSuggestionSearch(afterChange, loaded("stale"));

    expect(stale).toBe(afterChange);
    expect(ids(stale)).toStrictEqual([]);
    expect(stale.status).toBe("debouncing");
  });

  it("drops a failure that arrives after the query changed", () => {
    const inFlight = settle([
      { query: QUERY, type: "INPUT" },
      { type: "DEBOUNCED" },
    ]);
    const afterChange = reduceSuggestionSearch(inFlight, {
      query: { ...QUERY, content: "different" },
      type: "INPUT",
    });

    expect(reduceSuggestionSearch(afterChange, { type: "FAILED" })).toBe(
      afterChange
    );
  });

  it("empties the panel when the request fails", () => {
    // Showing the previous query's results under a failed one would look like
    // an answer to the question that just failed.
    const state = settle([
      { query: QUERY, type: "INPUT" },
      { type: "DEBOUNCED" },
      loaded("a"),
      { query: { ...QUERY, title: "Export missing" }, type: "INPUT" },
      { type: "DEBOUNCED" },
      { type: "FAILED" },
    ]);

    expect(state).toStrictEqual({ suggestions: [], status: "failed" });
  });

  it("ignores a debounce that no input armed", () => {
    expect(
      reduceSuggestionSearch(initialSuggestionSearchState, {
        type: "DEBOUNCED",
      })
    ).toBe(initialSuggestionSearchState);
  });

  it("ignores a settle that no request is waiting on", () => {
    const settled = settle([
      { query: QUERY, type: "INPUT" },
      { type: "DEBOUNCED" },
      loaded("a"),
    ]);

    expect(reduceSuggestionSearch(settled, loaded("b"))).toBe(settled);
    expect(reduceSuggestionSearch(settled, { type: "FAILED" })).toBe(settled);
  });

  it("reports pending only while a timer or a request is outstanding", () => {
    const pendingFor = (events: readonly SuggestionSearchEvent[]) =>
      isSuggestionSearchPending(settle(events));

    expect(pendingFor([])).toBe(false);
    expect(pendingFor([{ query: QUERY, type: "INPUT" }])).toBe(true);
    expect(
      pendingFor([{ query: QUERY, type: "INPUT" }, { type: "DEBOUNCED" }])
    ).toBe(true);
    expect(
      pendingFor([
        { query: QUERY, type: "INPUT" },
        { type: "DEBOUNCED" },
        loaded("a"),
      ])
    ).toBe(false);
    expect(
      pendingFor([
        { query: QUERY, type: "INPUT" },
        { type: "DEBOUNCED" },
        { type: "FAILED" },
      ])
    ).toBe(false);
  });
});
