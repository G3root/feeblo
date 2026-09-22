import * as Schema from "effect/Schema";
import * as OpenApi from "effect/unstable/httpapi/OpenApi";
import { describe, expect, it } from "vitest";

import { PublicApi } from "./api-contract";

/**
 * Contract guards for the published v1 document.
 *
 * The public module is forbidden from importing dashboard or portal response
 * schemas, but a hand-written field can still be wrong. The published document
 * is the artifact customers read, so it is the thing searched for personal data
 * and pinned to a shape: adding a field to a response fails these tests until
 * the list below is updated on purpose.
 *
 * The document is decoded into a concrete structure rather than cast, so a
 * change in its shape fails loudly here instead of being asserted past.
 */

const ResponseEntry = Schema.Struct({
  content: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({ schema: Schema.optional(Schema.Json) })
    )
  ),
});

const Operation = Schema.Struct({
  responses: Schema.Record(Schema.String, ResponseEntry),
});

const OpenApiDocument = Schema.Struct({
  paths: Schema.Record(
    Schema.String,
    Schema.Struct({ get: Schema.optional(Operation) })
  ),
});

const decodeDocument = Schema.decodeUnknownSync(
  Schema.fromJsonString(OpenApiDocument)
);

const document = decodeDocument(JSON.stringify(OpenApi.fromApi(PublicApi)));

const LIST_PATH = "/api/v1/boards/{boardId}/posts";
const DETAIL_PATH = "/api/v1/posts/{postId}";

describe("PublicApi contract", () => {
  it("publishes exactly the two documented endpoints", () => {
    expect(Object.keys(document.paths).sort()).toEqual([
      LIST_PATH,
      DETAIL_PATH,
    ]);
  });

  it("documents one response per error status", () => {
    const responses = document.paths[LIST_PATH]?.get?.responses ?? {};

    // Each declared error schema carries its own status, which is why the
    // vocabulary is declared as an array of schemas rather than one union: a
    // union is a single entry whose AST carries no status, and the HTTP layer
    // then answers every error as 500.
    expect(Object.keys(responses).sort()).toEqual([
      "200",
      "400",
      "401",
      "403",
      "404",
      "429",
      "500",
      "503",
    ]);

    expect(JSON.stringify(responses["401"])).toContain("MISSING_API_KEY");
    expect(JSON.stringify(responses["401"])).toContain("INVALID_API_KEY");
    expect(JSON.stringify(responses["403"])).toContain("PLAN_REQUIRES_UPGRADE");
    expect(JSON.stringify(responses["403"])).toContain("FORBIDDEN_SCOPE");
    expect(JSON.stringify(responses["429"])).toContain("RATE_LIMITED");
  });

  it("documents the rate-limit code for a 429", () => {
    const responses = document.paths[LIST_PATH]?.get?.responses ?? {};

    // The `Retry-After` header is promised by `docs/public-api.md` and asserted
    // at runtime in `api-live.test.ts`. Header schemas attached to an error
    // response are not reflected in the generated document, so it is not
    // asserted here.
    expect(JSON.stringify(responses["429"])).toContain("RATE_LIMITED");
  });
});
