import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import {
  DataImportProviderCredentialError,
  DataImportProviderEmptyError,
} from "../errors";
import { makeProductboardImportProvider } from "./productboard";

type EntityFixture = {
  readonly id: string;
  readonly type: string;
  readonly fields: {
    readonly name: string;
    readonly description?: string;
    readonly status?: { readonly name: string };
    readonly archived?: boolean;
  };
  readonly relationships?: {
    readonly data: readonly {
      readonly type: string;
      readonly target: { readonly id: string };
    }[];
  };
  readonly createdAt?: string;
};

const entity = (overrides: Partial<EntityFixture>): EntityFixture => ({
  fields: { name: "A feature" },
  id: "f-1",
  type: "feature",
  ...overrides,
});

type ResponseBody =
  | {
      readonly data: readonly EntityFixture[];
      readonly links?: { readonly next: string };
    }
  | { readonly message: string };

const jsonResponse = (
  request: Parameters<Parameters<typeof HttpClient.make>[0]>[0],
  status: number,
  body: ResponseBody
) =>
  HttpClientResponse.fromWeb(
    request,
    new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
      status,
    })
  );

/**
 * Answers by the `type[]` the request names. A `page` number lets a test
 * serve a second feature page without a URL map.
 */
const pagedClient = (
  pages: Readonly<
    Record<
      string,
      readonly {
        readonly data: readonly EntityFixture[];
        readonly links?: { readonly next: string };
      }[]
    >
  >
) => {
  const index = new Map<string, number>();

  return HttpClient.make((request) => {
    const type = /type\[\]=([a-z]+)/u.exec(request.url)?.[1] ?? "feature";
    const pageIndex = index.get(type) ?? 0;
    index.set(type, pageIndex + 1);

    const body = pages[type]?.[pageIndex] ?? { data: [] };

    return Effect.succeed(jsonResponse(request, 200, body));
  });
};

describe("Productboard import adapter", () => {
  it.effect("maps features, their component board and status", () =>
    Effect.gen(function* () {
      const adapter = makeProductboardImportProvider({
        httpClient: pagedClient({
          component: [
            {
              data: [
                entity({
                  fields: { name: "Mobile" },
                  id: "c-1",
                  type: "component",
                }),
              ],
            },
          ],
          feature: [
            {
              data: [
                entity({
                  fields: {
                    description: "<p>First line</p><p>Second &amp; last</p>",
                    name: "Dark mode",
                    status: { name: "In progress" },
                  },
                  id: "f-1",
                  relationships: {
                    data: [{ target: { id: "c-1" }, type: "parent" }],
                  },
                }),
                entity({
                  fields: { archived: true, name: "Old idea" },
                  id: "f-2",
                }),
                entity({
                  fields: { name: "No component" },
                  id: "f-3",
                  type: "subfeature",
                }),
              ],
            },
          ],
          product: [
            {
              data: [
                entity({
                  fields: { name: "Product" },
                  id: "p-1",
                  type: "product",
                }),
              ],
            },
          ],
        }),
      });

      const result = yield* adapter.fetchPosts({
        credentials: { apiKey: "a-token" },
      });

      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toMatchObject({
        board: "Mobile",
        content: "First line\nSecond & last",
        status: "In progress",
        title: "Dark mode",
      });
      expect(result.rows[1]).toMatchObject({
        board: "",
        status: "",
        title: "No component",
      });
      expect(result.fingerprint).toBe("f-1\nf-3");
      expect(result.notices).toEqual([
        "Productboard returned 2 features.",
        "Productboard vote counts and comments are not imported.",
        "Skipped 1 archived feature.",
      ]);
    })
  );

  it.effect("walks every page of features", () =>
    Effect.gen(function* () {
      const adapter = makeProductboardImportProvider({
        httpClient: pagedClient({
          feature: [
            {
              data: [entity({ id: "f-1" })],
              links: {
                next: "https://api.productboard.com/v2/entities?page=2",
              },
            },
            { data: [entity({ id: "f-2" })] },
          ],
        }),
      });

      const result = yield* adapter.fetchPosts({
        credentials: { apiKey: "a-token" },
      });

      expect(result.rows).toHaveLength(2);
      expect(result.fingerprint).toBe("f-1\nf-2");
    })
  );

  it.effect("reports a rejected token as a credential failure", () =>
    Effect.gen(function* () {
      const adapter = makeProductboardImportProvider({
        httpClient: HttpClient.make((request) =>
          Effect.succeed(jsonResponse(request, 403, { message: "no" }))
        ),
      });

      const error = yield* Effect.flip(
        adapter.fetchPosts({ credentials: { apiKey: "wrong" } })
      );

      expect(error).toBeInstanceOf(DataImportProviderCredentialError);
    })
  );

  it.effect("refuses a workspace with no features", () =>
    Effect.gen(function* () {
      const adapter = makeProductboardImportProvider({
        httpClient: pagedClient({ feature: [{ data: [] }] }),
      });

      const error = yield* Effect.flip(
        adapter.fetchPosts({ credentials: { apiKey: "a-token" } })
      );

      expect(error).toBeInstanceOf(DataImportProviderEmptyError);
    })
  );

  it.effect("requires a token", () =>
    Effect.gen(function* () {
      const adapter = makeProductboardImportProvider({});

      const error = yield* Effect.flip(
        adapter.fetchPosts({ credentials: { apiKey: "  " } })
      );

      expect(error._tag).toBe("DataImportProviderCredentialError");
    })
  );
});
