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
import { makeNoltImportProvider, resolveNoltBoardOrigin } from "./nolt";

const textResponse = (
  request: Parameters<Parameters<typeof HttpClient.make>[0]>[0],
  status: number,
  body: string,
  headers: Readonly<Record<string, string>> = {}
) =>
  HttpClientResponse.fromWeb(
    request,
    new Response(body, {
      headers: { "content-type": "text/csv", ...headers },
      status,
    })
  );

const CSV_HEADER =
  "id,title,description,board,status,upvotes,author name,author email,created at,tags,url";

const csvResponse = (rows: readonly string[]) =>
  HttpClient.make((request) =>
    Effect.succeed(textResponse(request, 200, [CSV_HEADER, ...rows].join("\n")))
  );

describe("Nolt import adapter", () => {
  it.effect("maps an export onto the shared import row contract", () =>
    Effect.gen(function* () {
      const adapter = makeNoltImportProvider({
        httpClient: csvResponse([
          'n-1,"A big idea","The body","Feature Requests","In progress",12,"Ada","ada@example.com","2026-01-02T03:04:05.000Z","ios;web","https://acme.nolt.io/p/1"',
          'n-2,"Another idea","","Ideas","",3,"","","",""',
        ]),
      });

      const result = yield* adapter.fetchPosts({
        credentials: { apiKey: "a-key", boardUrl: "acme.nolt.io" },
      });

      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toMatchObject({
        authorEmail: "ada@example.com",
        authorName: "Ada",
        board: "Feature Requests",
        content: "The body",
        createdAt: "2026-01-02T03:04:05.000Z",
        rowNumber: 2,
        status: "In progress",
        tags: ["ios", "web"],
        title: "A big idea",
        url: "https://acme.nolt.io/p/1",
        voteCount: "12",
      });
      expect(result.rows[1]).toMatchObject({
        authorEmail: "",
        board: "Ideas",
        content: "",
        rowNumber: 3,
        status: "",
        tags: [],
        title: "Another idea",
      });
      // The board origin is part of the fingerprint: two Nolt boards with the
      // same post id are not the same import.
      expect(result.fingerprint).toBe("https://acme.nolt.io\nn-1\nn-2");
      expect(result.notices).toEqual([
        "Nolt returned 2 posts.",
        "Nolt vote counts and comments are not imported.",
      ]);
    })
  );

  it.effect("accepts a bare board name and rejects a foreign host", () =>
    Effect.gen(function* () {
      expect(yield* resolveNoltBoardOrigin("acme")).toBe(
        "https://acme.nolt.io"
      );
      expect(yield* resolveNoltBoardOrigin("https://acme.nolt.io/posts")).toBe(
        "https://acme.nolt.io"
      );

      const error = yield* Effect.flip(
        resolveNoltBoardOrigin("https://acme.example.com")
      );

      expect(error._tag).toBe("DataImportProviderCredentialError");
    })
  );

  it.effect("reports a rejected key as a credential failure", () =>
    Effect.gen(function* () {
      const adapter = makeNoltImportProvider({
        httpClient: HttpClient.make((request) =>
          Effect.succeed(textResponse(request, 401, "no"))
        ),
      });

      const error = yield* Effect.flip(
        adapter.fetchPosts({
          credentials: { apiKey: "wrong", boardUrl: "acme.nolt.io" },
        })
      );

      expect(error).toBeInstanceOf(DataImportProviderCredentialError);
    })
  );

  it.effect("keeps the provider's Retry-After on a rate limit", () =>
    Effect.gen(function* () {
      const adapter = makeNoltImportProvider({
        httpClient: HttpClient.make((request) =>
          Effect.succeed(
            textResponse(request, 429, "slow", { "retry-after": "60" })
          )
        ),
      });

      const error = yield* Effect.flip(
        adapter.fetchPosts({
          credentials: { apiKey: "a-key", boardUrl: "acme.nolt.io" },
        })
      );

      expect(error).toBeInstanceOf(DataImportProviderRateLimitedError);
      expect(error).toMatchObject({ retryAfterSeconds: 60 });
    })
  );

  it.effect("refuses a board with no posts", () =>
    Effect.gen(function* () {
      const adapter = makeNoltImportProvider({ httpClient: csvResponse([]) });

      const error = yield* Effect.flip(
        adapter.fetchPosts({
          credentials: { apiKey: "a-key", boardUrl: "acme.nolt.io" },
        })
      );

      expect(error).toBeInstanceOf(DataImportProviderEmptyError);
    })
  );

  it.effect("reports an export with no title column", () =>
    Effect.gen(function* () {
      const adapter = makeNoltImportProvider({
        httpClient: HttpClient.make((request) =>
          Effect.succeed(textResponse(request, 200, "id,body\n1,hello"))
        ),
      });

      const error = yield* Effect.flip(
        adapter.fetchPosts({
          credentials: { apiKey: "a-key", boardUrl: "acme.nolt.io" },
        })
      );

      expect(error).toBeInstanceOf(DataImportProviderResponseError);
    })
  );

  it.effect("requires both credential fields", () =>
    Effect.gen(function* () {
      const adapter = makeNoltImportProvider({});

      const missingKey = yield* Effect.flip(
        adapter.fetchPosts({ credentials: { boardUrl: "acme.nolt.io" } })
      );

      const missingBoard = yield* Effect.flip(
        adapter.fetchPosts({ credentials: { apiKey: "a-key" } })
      );

      expect(missingKey._tag).toBe("DataImportProviderCredentialError");
      expect(missingBoard._tag).toBe("DataImportProviderCredentialError");
    })
  );
});
