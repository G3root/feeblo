import { describe, expect, it } from "vitest";

import {
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  makeOperationCatalog,
  searchCatalog,
} from "./catalog";
import { PublicApiOperations } from "./operations";

/**
 * The catalog `search` answers from.
 *
 * The live suite (`mcp-live.test.ts`) drives the tool; these pin what the
 * answer is derived from: one entry per registry operation, a signature printed
 * from the operation's own schema, and a ranking that is reproducible.
 */
describe("operation catalog", () => {
  const catalog = makeOperationCatalog();

  it("lists every operation once", () => {
    const names = catalog.entries.map((entry) => entry.name);

    expect(names.sort()).toEqual(
      PublicApiOperations.map((operation) => operation.name).sort()
    );
    expect(new Set(names).size).toBe(names.length);
  });

  it("prints a callable signature from the operation's own schema", () => {
    const createPost = catalog.entries.find(
      (entry) => entry.name === "createPost"
    );

    expect(createPost?.signature).toContain(
      "(input: { boardId: string; title: string; content: string"
    );
    expect(createPost?.signature).toContain("Promise<");
    // A field the operation does not declare is not invented.
    expect(createPost?.signature).not.toContain("password");
  });

  it("carries the operation's scope and annotations", () => {
    for (const operation of PublicApiOperations) {
      const entry = catalog.entries.find(
        (candidate) => candidate.name === operation.name
      );

      expect(entry?.scope).toBe(operation.scope);
      expect(entry?.readOnly).toBe(operation.annotations.readOnly);
      expect(entry?.destructive).toBe(operation.annotations.destructive);
    }
  });

  it("ranks an exact operation name first", () => {
    for (const name of ["deletePost", "createTag", "listPostComments"]) {
      const result = searchCatalog(catalog, name);

      expect(result.matches[0]?.name).toBe(name);
    }
  });

  it("answers an unrelated query with no matches", () => {
    expect(searchCatalog(catalog, "zzzzzzzz").matches).toEqual([]);
    expect(searchCatalog(catalog, "zzzzzzzz").total).toBe(0);
  });

  it("pages without changing the total", () => {
    const all = searchCatalog(catalog, "tag", { limit: MAX_SEARCH_LIMIT });
    const first = searchCatalog(catalog, "tag", { limit: 2 });
    const second = searchCatalog(catalog, "tag", { limit: 2, offset: 2 });

    expect(all.matches.length).toBeGreaterThan(2);
    expect(first.matches).toHaveLength(2);
    expect(first.total).toBe(all.total);
    expect(second.matches.map((match) => match.name)).toEqual(
      all.matches.slice(2, 4).map((match) => match.name)
    );
  });

  it("clamps a limit a caller asks for out of range", () => {
    expect(searchCatalog(catalog, "tag").limit).toBe(DEFAULT_SEARCH_LIMIT);
    expect(searchCatalog(catalog, "tag", { limit: 1_000 }).limit).toBe(
      MAX_SEARCH_LIMIT
    );
    expect(searchCatalog(catalog, "tag", { limit: 0 }).limit).toBe(1);
    expect(searchCatalog(catalog, "tag", { offset: -5 }).offset).toBe(0);
  });
});
