import type { Json } from "effect/Schema";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchSuggestions,
  getOrganizationId,
  requestBoards,
  requestUpdates,
  submitFeedback,
} from "./requests";

/**
 * The iframe's half of the wire contract.
 *
 * Every request helper decodes its response through the server's own schema, so
 * these tests pin the seam: a valid payload decodes (dates included), and a
 * payload whose field the server renamed throws instead of rendering
 * `undefined`. The shell's globals and `fetch` are stubbed rather than the
 * modules that read them, so the test drives the real code path.
 */

const organizationId = "org_test";
const apiUrl = "https://api.feeblo.test";

const board = {
  id: "brd_1",
  name: "Feedback",
  slug: "feedback",
  organizationId,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

const update = {
  id: "chg_1",
  title: "Release",
  slug: "release",
  content: "<p>Body</p>",
  excerpt: "Body",
  imageUrl: null,
  publishedAt: "2026-02-01T00:00:00.000Z",
};

const suggestion = {
  id: "pst_1",
  title: "Similar",
  excerpt: "Similar",
  slug: "similar",
};

const stubBootEnv = () => {
  vi.stubGlobal("global", { __ENV: { API_URL: apiUrl, organizationId } });
};

const stubFetch = (body: Json, status = 200) => {
  const response = new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  vi.stubGlobal("fetch", () => Promise.resolve(response));
};

const feedbackForm = (fields: Record<string, string>) => {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    formData.set(name, value);
  }
  return formData;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("widget api boundary", () => {
  it("decodes a board response through the shared schema", async () => {
    stubBootEnv();
    stubFetch([board]);

    const boards = await requestBoards();

    expect(boards).toHaveLength(1);
    expect(boards[0]?.id).toBe(board.id);
    // `DateFromString` is the contract's, so the client gets a Date rather
    // than the raw string a hand-written interface would have declared.
    expect(boards[0]?.createdAt).toEqual(new Date(board.createdAt));
  });

  it("fails when the server renames a board field", async () => {
    stubBootEnv();
    const { updatedAt, ...renamed } = board;
    stubFetch([{ ...renamed, lastModified: updatedAt }]);

    // The rename must fail here, in the iframe, rather than reaching a
    // component that renders `undefined`.
    await expect(requestBoards()).rejects.toThrow();
  });

  it("decodes updates and suggestions", async () => {
    stubBootEnv();
    stubFetch([update]);
    const updates = await requestUpdates();
    expect(updates[0]?.publishedAt).toEqual(new Date(update.publishedAt));

    stubFetch([suggestion]);
    const suggestions = await fetchSuggestions(
      { boardId: board.id, content: "Content", title: "Title" },
      new AbortController().signal
    );
    expect(suggestions).toEqual([suggestion]);
  });

  it("reads the organization id through the boot contract", () => {
    stubBootEnv();

    expect(getOrganizationId()).toBe(organizationId);
  });

  it("fails at boot when the shell loses the organization id", () => {
    vi.stubGlobal("global", { __ENV: { API_URL: apiUrl } });

    expect(() => getOrganizationId()).toThrow();
  });

  it("decodes a refusal body instead of casting it", async () => {
    stubBootEnv();
    stubFetch({ message: "Board is not public" }, 400);

    const result = await submitFeedback(
      feedbackForm({
        boardId: board.id,
        boardName: board.name,
        title: "Title",
        content: "Content",
      })
    );

    expect(result).toEqual({ ok: false, message: "Board is not public" });
  });

  it("sends the request shape the endpoint decodes", async () => {
    stubBootEnv();
    let sentBody: Json | undefined;
    const fetchSpy = vi.fn((_url: string, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body));
      return Promise.resolve(
        new Response(JSON.stringify({ message: "ok" }), { status: 200 })
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await submitFeedback(
      feedbackForm({
        boardId: board.id,
        boardName: board.name,
        title: "Title",
        content: "Content",
      })
    );

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(sentBody).toEqual({
      boardId: board.id,
      content: "Content",
      metadata: {},
      organizationId,
      title: "Title",
    });
  });
});
