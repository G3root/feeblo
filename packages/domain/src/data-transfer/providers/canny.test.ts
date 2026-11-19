import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import {
  DataImportProviderCredentialError,
  DataImportProviderEmptyError,
  DataImportProviderRateLimitedError,
  DataImportProviderResponseError,
} from "../errors";
import { makeCannyImportProvider } from "./canny";

type CannyResponseBody =
  | { readonly error: string }
  | {
      readonly hasMore: boolean;
      readonly posts: readonly CannyPostFixture[];
    }
  | { readonly notPosts: true };

const jsonResponse = (
  request: Parameters<Parameters<typeof HttpClient.make>[0]>[0],
  status: number,
  body: CannyResponseBody,
  headers: Readonly<Record<string, string>> = {}
) =>
  HttpClientResponse.fromWeb(
    request,
    new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json", ...headers },
      status,
    })
  );

/** A transport that answers with the page for its zero-based request index. */
const pagedClient = (pages: readonly CannyResponseBody[]) => {
  let index = 0;

  return HttpClient.make((request) =>
    Effect.sync(() => {
      const page = pages[index] ?? { hasMore: false, posts: [] };
      index += 1;

      return jsonResponse(request, 200, page);
    })
  );
};

type CannyPostFixture = {
  author: { email: string; name: string } | null;
  board: { name: string };
  created: string;
  details: string | null;
  eta: string | null;
  id: string;
  score: number | undefined;
  status: string;
  tags: { name: string }[];
  title: string;
  url: string;
};

const post = (overrides: Partial<CannyPostFixture> = {}): CannyPostFixture => ({
  author: { email: "Sally@Example.com", name: "Sally Doe" },
  board: { name: "Feature Requests" },
  created: "2026-01-02T03:04:05.000Z",
  details: "A longer body",
  eta: "February 2020",
  id: "post-1",
  score: 12,
  status: "open",
  tags: [{ name: "iOS" }],
  title: "An idea",
  url: "https://example.canny.io/p/an-idea",
  ...overrides,
});

describe("Canny import adapter", () => {
  it.effect("maps posts onto the shared import row contract", () =>
    Effect.gen(function* () {
      const adapter = makeCannyImportProvider({
        httpClient: pagedClient([
          {
            hasMore: false,
            posts: [
              post(),
              post({
                author: null,
                details: null,
                eta: null,
                id: "post-2",
                score: undefined,
                status: "under review",
                tags: [],
                title: "Another idea",
              }),
            ],
          },
        ]),
      });

      const result = yield* adapter.fetchPosts({
        credentials: { apiKey: "a-key" },
      });

      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toMatchObject({
        authorEmail: "sally@example.com",
        authorName: "Sally Doe",
        board: "Feature Requests",
        content: "A longer body",
        createdAt: "2026-01-02T03:04:05.000Z",
        eta: "2020-Q1",
        rowNumber: 1,
        status: "Pending",
        tags: ["iOS"],
        title: "An idea",
      });
      // A status Canny renamed is passed through so a workspace status with
      // the same name still matches in the planner.
      expect(result.rows[1]).toMatchObject({
        authorEmail: "",
        content: "",
        eta: "",
        rowNumber: 2,
        status: "Review",
        tags: [],
      });
      // The fingerprint is the sorted set of provider ids, which is what the
      // service hashes for the duplicate-import warning.
      expect(result.fingerprint).toBe("post-1\npost-2");
      expect(result.notices).toEqual([
        "Canny returned 2 posts.",
        "Canny vote counts, comments and categories are not imported.",
      ]);
    })
  );

  it.effect("pages until the provider says there is nothing more", () =>
    Effect.gen(function* () {
      const firstPage = Array.from({ length: 100 }, (_, index) =>
        post({ id: `post-${index}` })
      );

      const adapter = makeCannyImportProvider({
        httpClient: pagedClient([
          { hasMore: true, posts: firstPage },
          { hasMore: false, posts: [post({ id: "post-last" })] },
        ]),
      });

      const result = yield* adapter.fetchPosts({
        credentials: { apiKey: "a-key" },
      });

      expect(result.rows).toHaveLength(101);
      expect(result.rows[100]?.rowNumber).toBe(101);
      expect(result.rows[100]?.title).toBe("An idea");
    })
  );

  it.effect("reports a rejected key as a credential failure", () =>
    Effect.gen(function* () {
      const adapter = makeCannyImportProvider({
        httpClient: HttpClient.make((request) =>
          Effect.succeed(jsonResponse(request, 401, { error: "invalid key" }))
        ),
      });

      const error = yield* Effect.flip(
        adapter.fetchPosts({ credentials: { apiKey: "wrong" } })
      );

      expect(error).toBeInstanceOf(DataImportProviderCredentialError);
      expect(error._tag).toBe("DataImportProviderCredentialError");
      // The provider's response body is never copied into the message.
      expect(error.message).not.toContain("invalid key");
    })
  );

  it.effect("keeps the provider's Retry-After on a rate limit", () =>
    Effect.gen(function* () {
      const adapter = makeCannyImportProvider({
        httpClient: HttpClient.make((request) =>
          Effect.succeed(
            jsonResponse(
              request,
              429,
              { error: "slow down" },
              {
                "retry-after": "120",
              }
            )
          )
        ),
      });

      const error = yield* Effect.flip(
        adapter.fetchPosts({ credentials: { apiKey: "a-key" } })
      );

      expect(error).toBeInstanceOf(DataImportProviderRateLimitedError);
      expect(error).toMatchObject({
        retryAfterSeconds: 120,
      });
    })
  );

  it.effect("refuses a key that can see no posts", () =>
    Effect.gen(function* () {
      const adapter = makeCannyImportProvider({
        httpClient: pagedClient([{ hasMore: false, posts: [] }]),
      });

      const error = yield* Effect.flip(
        adapter.fetchPosts({ credentials: { apiKey: "a-key" } })
      );

      expect(error).toBeInstanceOf(DataImportProviderEmptyError);
    })
  );

  it.effect("reports a response it cannot read", () =>
    Effect.gen(function* () {
      const adapter = makeCannyImportProvider({
        httpClient: pagedClient([{ notPosts: true }]),
      });

      const error = yield* Effect.flip(
        adapter.fetchPosts({ credentials: { apiKey: "a-key" } })
      );

      expect(error).toBeInstanceOf(DataImportProviderResponseError);
    })
  );
});
