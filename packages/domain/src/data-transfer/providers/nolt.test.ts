import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as UrlParams from "effect/http/UrlParams";

import {
  DataImportProviderCredentialError,
  DataImportProviderEmptyError,
  DataImportProviderRateLimitedError,
  DataImportProviderResponseError,
} from "../errors";
import { DATA_IMPORT_MAX_BYTES } from "../limits";
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

type ChunkedBody = {
  readonly canceled: () => boolean;
  readonly pulls: () => number;
  readonly response: Response;
};

/**
 * A body that only produces a chunk when the consumer asks for one, so a test
 * can tell whether an oversized read stopped before the next chunk.
 */
const chunkedResponse = (chunks: readonly Uint8Array[]): ChunkedBody => {
  let index = 0;
  let pulled = 0;
  let canceled = false;

  const stream = new ReadableStream<Uint8Array>(
    {
      cancel() {
        canceled = true;
      },
      pull(controller) {
        const chunk = chunks[index];

        if (chunk === undefined) {
          controller.close();

          return;
        }

        index += 1;
        pulled += 1;
        controller.enqueue(chunk);
      },
    },
    { highWaterMark: 0 }
  );

  return {
    canceled: () => canceled,
    pulls: () => pulled,
    response: new Response(stream, {
      headers: { "content-type": "text/csv" },
    }),
  };
};

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

  it.effect("sends the key unwrapped in the query", () =>
    Effect.gen(function* () {
      let requestQuery = "";

      const adapter = makeNoltImportProvider({
        httpClient: HttpClient.make((request) => {
          requestQuery = UrlParams.toString(request.urlParams);

          return Effect.succeed(
            textResponse(
              request,
              200,
              [CSV_HEADER, "n-1,A post,Body,,,0,,,,"].join("\n")
            )
          );
        }),
      });

      yield* adapter.fetchPosts({
        credentials: { apiKey: "a-key", boardUrl: "acme.nolt.io" },
      });

      expect(requestQuery).toContain("apikey=a-key");
    })
  );

  it.effect("reads a multi-chunk export split inside a character", () =>
    Effect.gen(function* () {
      const encoder = new TextEncoder();

      const body = encoder.encode(
        [CSV_HEADER, "n-1,Café,Body,,,0,,,,"].join("\n")
      );

      // Split between the two UTF-8 bytes of `é`: decoding must happen after
      // the chunks are joined, not per chunk.
      const split = body.indexOf(0xc3);

      const chunks = [
        body.slice(0, split),
        body.slice(split, split + 1),
        body.slice(split + 1),
      ];

      const response = chunkedResponse(chunks);

      const adapter = makeNoltImportProvider({
        httpClient: HttpClient.make((request) =>
          Effect.succeed(HttpClientResponse.fromWeb(request, response.response))
        ),
      });

      const result = yield* adapter.fetchPosts({
        credentials: { apiKey: "a-key", boardUrl: "acme.nolt.io" },
      });

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.title).toBe("Café");
    })
  );

  it.effect("stops at the byte cap on a multi-chunk non-ASCII export", () =>
    Effect.gen(function* () {
      const encoder = new TextEncoder();
      // The string is under the cap, but its UTF-8 encoding is over it.
      const title = "é".repeat(Math.floor(DATA_IMPORT_MAX_BYTES / 2) + 2);
      const body = encoder.encode([CSV_HEADER, `"${title}"`].join("\n"));
      const first = Math.floor(body.byteLength / 3);
      const second = Math.floor((body.byteLength * 2) / 3);

      const chunks = [
        body.slice(0, first),
        body.slice(first, second),
        body.slice(second),
        encoder.encode("this chunk must never be pulled"),
      ];

      const response = chunkedResponse(chunks);

      const adapter = makeNoltImportProvider({
        httpClient: HttpClient.make((request) =>
          Effect.succeed(HttpClientResponse.fromWeb(request, response.response))
        ),
      });

      const error = yield* Effect.flip(
        adapter.fetchPosts({
          credentials: { apiKey: "a-key", boardUrl: "acme.nolt.io" },
        })
      );

      expect(error).toBeInstanceOf(DataImportProviderResponseError);
      expect(error.message).toContain("larger than 10 MB");
      expect(response.pulls()).toBe(3);
      expect(response.canceled()).toBe(true);
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
