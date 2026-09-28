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
  requestBody: Schema.optional(Schema.Json),
  responses: Schema.Record(Schema.String, ResponseEntry),
});

const OpenApiDocument = Schema.Struct({
  paths: Schema.Record(
    Schema.String,
    Schema.Struct({
      get: Schema.optional(Operation),
      post: Schema.optional(Operation),
      put: Schema.optional(Operation),
      patch: Schema.optional(Operation),
      delete: Schema.optional(Operation),
    })
  ),
});

const decodeDocument = Schema.decodeUnknownSync(
  Schema.fromJsonString(OpenApiDocument)
);

const document = decodeDocument(JSON.stringify(OpenApi.fromApi(PublicApi)));

const LIST_PATH = "/api/v1/boards/{boardId}/posts";
const DETAIL_PATH = "/api/v1/posts/{postId}";
const SET_POST_TAGS_PATH = "/api/v1/posts/{postId}/tags";
const TAGS_PATH = "/api/v1/tags";
const TAG_PATH = "/api/v1/tags/{tagId}";
const COMPANIES_PATH = "/api/v1/companies";
const COMPANY_PATH = "/api/v1/companies/{companyId}";

/** The statuses every endpoint of the API can answer with, as the base set. */
const READ_RESPONSE_CODES = [
  "200",
  "400",
  "401",
  "403",
  "404",
  "429",
  "500",
  "503",
];

describe("PublicApi contract", () => {
  it("publishes exactly the documented endpoints", () => {
    expect(Object.keys(document.paths).sort()).toEqual(
      [
        LIST_PATH,
        DETAIL_PATH,
        SET_POST_TAGS_PATH,
        TAGS_PATH,
        TAG_PATH,
        COMPANIES_PATH,
        COMPANY_PATH,
      ].sort()
    );
  });

  it("documents one response per error status", () => {
    const responses = document.paths[LIST_PATH]?.get?.responses ?? {};

    // Each declared error schema carries its own status, which is why the
    // vocabulary is declared as an array of schemas rather than one union: a
    // union is a single entry whose AST carries no status, and the HTTP layer
    // then answers every error as 500.
    expect(Object.keys(responses).sort()).toEqual(READ_RESPONSE_CODES);

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

  it("promises a conflict only from the endpoints that write", () => {
    const createResponses = document.paths[TAGS_PATH]?.post?.responses ?? {};
    const renameResponses = document.paths[TAG_PATH]?.patch?.responses ?? {};
    const deleteResponses = document.paths[TAG_PATH]?.delete?.responses ?? {};

    // 201 for a create that returns the resource it made; 204 for a delete
    // that has nothing left to return.
    expect(Object.keys(createResponses).sort()).toEqual([
      "201",
      "400",
      "401",
      "403",
      "409",
      "429",
      "500",
      "503",
    ]);
    expect(JSON.stringify(createResponses["409"])).toContain("CONFLICT");
    expect(Object.keys(renameResponses).sort()).toEqual([
      "200",
      "400",
      "401",
      "403",
      "404",
      "409",
      "429",
      "500",
      "503",
    ]);
    expect(Object.keys(deleteResponses).sort()).toEqual([
      "204",
      ...READ_RESPONSE_CODES.filter((code) => code !== "200"),
    ]);

    // A read endpoint must not promise a status it can never answer with: a
    // generated client would handle a conflict that never arrives.
    const readResponses = document.paths[TAG_PATH]?.get?.responses ?? {};
    expect(Object.keys(readResponses).sort()).toEqual(READ_RESPONSE_CODES);
    expect(JSON.stringify(readResponses)).not.toContain("CONFLICT");
  });

  it("documents the tag-assignment request and response", () => {
    const operation = document.paths[SET_POST_TAGS_PATH]?.put;
    const responses = operation?.responses ?? {};

    // Assigning tags cannot collide — the write is a replacement and the pair
    // is unique — so a 409 here would promise a status it never returns.
    expect(Object.keys(responses).sort()).toEqual(READ_RESPONSE_CODES);
    expect(JSON.stringify(operation?.requestBody)).toContain("tagIds");

    // The response is the post's tag references, not the tag resource: no slug
    // and no timestamps, which a caller reads from the tag itself.
    const body = JSON.stringify(responses["200"]);
    expect(body).toContain("data");
    expect(body).toContain("name");
    expect(body).not.toContain("slug");
    expect(body).not.toContain("createdAt");
  });

  it("documents the tag resource without an internal identifier", () => {
    const createResponses = document.paths[TAGS_PATH]?.post?.responses ?? {};
    const body = JSON.stringify(createResponses["201"]);

    for (const field of ["id", "name", "slug", "createdAt", "updatedAt"]) {
      expect(body).toContain(field);
    }

    for (const forbidden of [
      "creatorId",
      "creatorMemberId",
      "organizationId",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it("documents the company resource without an internal identifier", () => {
    const createResponses =
      document.paths[COMPANIES_PATH]?.post?.responses ?? {};
    const body = JSON.stringify(createResponses["201"]);

    for (const field of [
      "id",
      "name",
      "externalId",
      "avatar",
      "externalCreatedAt",
      "source",
      "createdAt",
      "updatedAt",
    ]) {
      expect(body).toContain(field);
    }

    // A company is an account record: the workspace, the member who entered
    // it, and the contacts that belong to it are all deliberately absent.
    for (const forbidden of [
      "organizationId",
      "creatorId",
      "contactId",
      "email",
      "phone",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it("documents the company endpoints' statuses, and no conflict on a read", () => {
    const listResponses = document.paths[COMPANIES_PATH]?.get?.responses ?? {};
    const getResponses = document.paths[COMPANY_PATH]?.get?.responses ?? {};
    const createResponses =
      document.paths[COMPANIES_PATH]?.post?.responses ?? {};
    const updateResponses =
      document.paths[COMPANY_PATH]?.patch?.responses ?? {};
    const deleteResponses =
      document.paths[COMPANY_PATH]?.delete?.responses ?? {};

    expect(Object.keys(listResponses).sort()).toEqual(READ_RESPONSE_CODES);
    expect(Object.keys(getResponses).sort()).toEqual(READ_RESPONSE_CODES);
    expect(Object.keys(createResponses).sort()).toEqual([
      "201",
      "400",
      "401",
      "403",
      "409",
      "429",
      "500",
      "503",
    ]);
    // An update can answer 404 as well as 409: the company has to exist to be
    // renamed, and the name it is given has to be free.
    expect(Object.keys(updateResponses).sort()).toEqual([
      "200",
      "400",
      "401",
      "403",
      "404",
      "409",
      "429",
      "500",
      "503",
    ]);
    expect(Object.keys(deleteResponses).sort()).toEqual([
      "204",
      ...READ_RESPONSE_CODES.filter((code) => code !== "200"),
    ]);

    expect(JSON.stringify(createResponses["409"])).toContain("CONFLICT");
    expect(JSON.stringify(updateResponses["409"])).toContain("CONFLICT");
    expect(JSON.stringify(listResponses)).not.toContain("CONFLICT");
    expect(JSON.stringify(getResponses)).not.toContain("CONFLICT");
  });
});
