import { describe, expect, it } from "vitest";

import type { WidgetHelpArticle } from "../../lib/api";
import {
  helpArticleQuery,
  initialHelpArticleSearchState,
  isHelpArticleSearchPending,
  reduceHelpArticleSearch,
  type HelpArticleSearchEvent,
  type HelpArticleSearchState,
} from "./help-article-search";

/**
 * The reducer is the whole graph, so these tests walk it event by event. The
 * driver in `create-help-article-search.ts` adds only a timer and an abort
 * controller; the minimum-length gate and the session latch are here.
 */

const QUERY = "invite my team";

const article = (id: string): WidgetHelpArticle => ({
  excerpt: "excerpt",
  id,
  title: `Article ${id}`,
  url: `https://acme.feeblo.test/help/${id}`,
});

const settle = (
  events: readonly HelpArticleSearchEvent[],
  state: HelpArticleSearchState = initialHelpArticleSearchState
) => events.reduce(reduceHelpArticleSearch, state);

const loaded = (
  enabled: boolean,
  ...ids: string[]
): HelpArticleSearchEvent => ({
  articles: ids.map(article),
  enabled,
  type: "LOADED",
});

const ids = (state: HelpArticleSearchState) =>
  state.articles.map((entry) => entry.id);

describe("help article search reducer", () => {
  it("starts idle, enabled, with nothing to show", () => {
    expect(initialHelpArticleSearchState).toStrictEqual({
      articles: [],
      enabled: true,
      status: "idle",
    });
  });

  it("asks only about a trimmed title of at least three characters", () => {
    expect(helpArticleQuery("")).toBeNull();
    expect(helpArticleQuery("  ab  ")).toBeNull();
    expect(helpArticleQuery("  abc  ")).toBe("abc");
    expect(helpArticleQuery("Invite")).toBe("Invite");
  });

  it("shows the answer to the query that is in flight", () => {
    const state = settle([
      { query: QUERY, type: "INPUT" },
      { type: "DEBOUNCED" },
      loaded(true, "a", "b"),
    ]);

    expect(state.status).toBe("ready");
    expect(ids(state)).toStrictEqual(["a", "b"]);
  });

  it("keeps the last result visible while a newer query is pending", () => {
    // The flash this removes: the panel used to empty on every keystroke.
    const settled = settle([
      { query: QUERY, type: "INPUT" },
      { type: "DEBOUNCED" },
      loaded(true, "a", "b"),
    ]);

    const debouncing = reduceHelpArticleSearch(settled, {
      query: "invite my team please",
      type: "INPUT",
    });

    expect(ids(debouncing)).toStrictEqual(["a", "b"]);
    expect(debouncing.status).toBe("debouncing");

    const loading = reduceHelpArticleSearch(debouncing, { type: "DEBOUNCED" });
    expect(ids(loading)).toStrictEqual(["a", "b"]);
    expect(loading.status).toBe("loading");
  });

  it("drops an answer that arrives after the query changed", () => {
    const inFlight = settle([
      { query: QUERY, type: "INPUT" },
      { type: "DEBOUNCED" },
    ]);

    const afterChange = reduceHelpArticleSearch(inFlight, {
      query: "a different question",
      type: "INPUT",
    });

    expect(reduceHelpArticleSearch(afterChange, loaded(true, "stale"))).toBe(
      afterChange
    );
  });

  it("clears the panel when the title is too short to ask about", () => {
    const state = settle([
      { query: QUERY, type: "INPUT" },
      { type: "DEBOUNCED" },
      loaded(true, "a"),
      { query: null, type: "INPUT" },
    ]);

    expect(state).toStrictEqual({
      articles: [],
      enabled: true,
      status: "idle",
    });
  });

  it("empties the panel when the request fails", () => {
    const state = settle([
      { query: QUERY, type: "INPUT" },
      { type: "DEBOUNCED" },
      loaded(true, "a"),
      { query: "invite my team please", type: "INPUT" },
      { type: "DEBOUNCED" },
      { type: "FAILED" },
    ]);

    expect(state).toStrictEqual({
      articles: [],
      enabled: true,
      status: "failed",
    });
  });

  it("latches a disabled answer and never asks again", () => {
    const disabled = settle([
      { query: QUERY, type: "INPUT" },
      { type: "DEBOUNCED" },
      // Articles alongside `enabled: false` are not documentation this
      // workspace publishes, so the answer is the latch, not the payload.
      loaded(false, "a"),
    ]);

    expect(disabled).toStrictEqual({
      articles: [],
      enabled: false,
      status: "ready",
    });

    // The next keystroke and the debounce it would have armed are both no-ops:
    // the workspace's answer outlives the query that asked for it.
    const afterTyping = reduceHelpArticleSearch(disabled, {
      query: "a different question",
      type: "INPUT",
    });

    expect(afterTyping).toBe(disabled);
    expect(reduceHelpArticleSearch(afterTyping, { type: "DEBOUNCED" })).toBe(
      disabled
    );
    expect(reduceHelpArticleSearch(afterTyping, loaded(true, "b"))).toBe(
      disabled
    );
    expect(reduceHelpArticleSearch(afterTyping, { type: "FAILED" })).toBe(
      disabled
    );
  });

  it("reports pending only while a timer or a request is outstanding", () => {
    const pendingFor = (events: readonly HelpArticleSearchEvent[]) =>
      isHelpArticleSearchPending(settle(events));

    expect(pendingFor([])).toBe(false);
    expect(pendingFor([{ query: QUERY, type: "INPUT" }])).toBe(true);
    expect(
      pendingFor([{ query: QUERY, type: "INPUT" }, { type: "DEBOUNCED" }])
    ).toBe(true);
    expect(
      pendingFor([
        { query: QUERY, type: "INPUT" },
        { type: "DEBOUNCED" },
        loaded(true, "a"),
      ])
    ).toBe(false);
    expect(pendingFor([{ query: null, type: "INPUT" }])).toBe(false);
  });
});
