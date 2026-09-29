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
  parameters: Schema.optional(
    Schema.Array(
      Schema.Struct({
        in: Schema.String,
        name: Schema.String,
        schema: Schema.Json,
      })
    )
  ),
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
const POSTS_PATH = "/api/v1/posts";
const RETRIEVE_PATH = "/api/v1/posts/retrieve";
const DETAIL_PATH = "/api/v1/posts/{postId}";
const SET_POST_TAGS_PATH = "/api/v1/posts/{postId}/tags";
const TAGS_PATH = "/api/v1/tags";
const TAG_PATH = "/api/v1/tags/{tagId}";
const COMPANIES_PATH = "/api/v1/companies";
const COMPANY_PATH = "/api/v1/companies/{companyId}";
const CHANGELOG_PATH = "/api/v1/changelog";
const CHANGELOG_ENTRY_PATH = "/api/v1/changelog/{changelogId}";

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
        POSTS_PATH,
        RETRIEVE_PATH,
        CHANGELOG_PATH,
        CHANGELOG_ENTRY_PATH,
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

    // The changelog write pair carries the same promise: a create and an
    // update can both collide on the workspace's slug index.
    const changelogCreateResponses =
      document.paths[CHANGELOG_PATH]?.post?.responses ?? {};
    const changelogUpdateResponses =
      document.paths[CHANGELOG_ENTRY_PATH]?.patch?.responses ?? {};
    const changelogDeleteResponses =
      document.paths[CHANGELOG_ENTRY_PATH]?.delete?.responses ?? {};
    const changelogReadResponses =
      document.paths[CHANGELOG_ENTRY_PATH]?.get?.responses ?? {};

    expect(Object.keys(changelogCreateResponses).sort()).toEqual([
      "201",
      "400",
      "401",
      "403",
      "409",
      "429",
      "500",
      "503",
    ]);
    expect(JSON.stringify(changelogCreateResponses["409"])).toContain(
      "CONFLICT"
    );
    expect(Object.keys(changelogUpdateResponses).sort()).toEqual([
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
    expect(Object.keys(changelogDeleteResponses).sort()).toEqual([
      "204",
      ...READ_RESPONSE_CODES.filter((code) => code !== "200"),
    ]);
    expect(Object.keys(changelogReadResponses).sort()).toEqual(
      READ_RESPONSE_CODES
    );
  });

  it("documents the workspace post list and the retrieve lookup", () => {
    const listResponses = document.paths[POSTS_PATH]?.get?.responses ?? {};
    const retrieveResponses =
      document.paths[RETRIEVE_PATH]?.get?.responses ?? {};

    // Both read a post, so neither promises a conflict and both can answer
    // the missing-resource status.
    expect(Object.keys(listResponses).sort()).toEqual(READ_RESPONSE_CODES);
    expect(Object.keys(retrieveResponses).sort()).toEqual(READ_RESPONSE_CODES);
    expect(JSON.stringify(retrieveResponses)).not.toContain("CONFLICT");

    // The list is the workspace-wide page: same query parameters as a board's
    // list, which is what lets a caller page both with one rule.
    const listParameters = (
      document.paths[POSTS_PATH]?.get?.parameters ?? []
    ).map((parameter) => parameter.name);
    expect(listParameters.sort()).toEqual([
      "cursor",
      "includeArchived",
      "limit",
      "status",
    ]);

    // The retrieve lookup accepts an id, a board, and a slug, all optional;
    // the board+slug pairing rule is the handler's, not the document's.
    const retrieveParameters = (
      document.paths[RETRIEVE_PATH]?.get?.parameters ?? []
    ).map((parameter) => parameter.name);
    expect(retrieveParameters.sort()).toEqual(["boardId", "id", "slug"]);

    const listBody = JSON.stringify(listResponses["200"]);
    expect(listBody).toContain("nextCursor");
  });

  it("documents the post resource and the write endpoints' statuses", () => {
    const createResponses = document.paths[POSTS_PATH]?.post?.responses ?? {};
    const updateResponses = document.paths[DETAIL_PATH]?.patch?.responses ?? {};
    const deleteResponses =
      document.paths[DETAIL_PATH]?.delete?.responses ?? {};

    // 201 for a create that returns the post it made, 200 for an update, 204
    // for a delete that has nothing left to return. A create can collide on
    // the workspace's slug index; an update never re-derives a slug, so it
    // promises no 409; and a create cannot report a missing resource.
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
    expect(Object.keys(updateResponses).sort()).toEqual(READ_RESPONSE_CODES);
    expect(Object.keys(deleteResponses).sort()).toEqual([
      "204",
      ...READ_RESPONSE_CODES.filter((code) => code !== "200"),
    ]);
    expect(JSON.stringify(createResponses["409"])).toContain("CONFLICT");
    expect(JSON.stringify(updateResponses)).not.toContain("CONFLICT");

    const createBody = JSON.stringify(createResponses["201"]);
    for (const field of [
      "id",
      "boardId",
      "title",
      "slug",
      "excerpt",
      "url",
      "status",
      "etaQuarter",
      "tags",
      "voteCount",
      "commentCount",
      "author",
      "createdAt",
      "updatedAt",
      "lockedAt",
      "archivedAt",
      "mergedIntoPostId",
      "content",
    ]) {
      expect(createBody).toContain(field);
    }

    // The dashboard's post row carries actor identifiers and the workspace id;
    // none of them has a name in this contract.
    for (const forbidden of [
      "creatorId",
      "creatorMemberId",
      "contactId",
      "organizationId",
      "userId",
    ]) {
      expect(createBody).not.toContain(forbidden);
    }

    // A create names the board, the title, the body, and the status it starts
    // in; an update may name any of the writable fields.
    const createRequest = JSON.stringify(document.paths[POSTS_PATH]?.post);
    for (const field of ["boardId", "title", "content", "statusId"]) {
      expect(createRequest).toContain(field);
    }

    const updateRequest = JSON.stringify(document.paths[DETAIL_PATH]?.patch);
    for (const field of [
      "title",
      "content",
      "statusId",
      "boardId",
      "etaQuarter",
    ]) {
      expect(updateRequest).toContain(field);
    }
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

  it("documents the changelog resource and its writable fields", () => {
    const createOperation = document.paths[CHANGELOG_PATH]?.post;
    const createBody = JSON.stringify(createOperation?.responses["201"]);

    for (const field of [
      "id",
      "title",
      "slug",
      "excerpt",
      "coverImage",
      "status",
      "scheduledAt",
      "publishedAt",
      "createdAt",
      "updatedAt",
      "content",
    ]) {
      expect(createBody).toContain(field);
    }

    // The dashboard's `Changelog` carries actor identifiers and the workspace
    // id; none of them has a name in this contract.
    for (const forbidden of [
      "creatorId",
      "creatorMemberId",
      "organizationId",
      "userId",
    ]) {
      expect(createBody).not.toContain(forbidden);
    }

    // `status` is required on an update but optional on a create: omitting it
    // from a create makes a draft, while an update that omitted it would move
    // an entry by leaving a field out.
    expect(JSON.stringify(createOperation?.requestBody)).toContain("title");
    expect(JSON.stringify(createOperation?.requestBody)).toContain("content");

    const updateOperation = document.paths[CHANGELOG_ENTRY_PATH]?.patch;
    const updateBody = JSON.stringify(updateOperation?.requestBody);
    expect(updateBody).toContain("status");
    expect(updateBody).toContain("title");
    expect(updateBody).toContain("content");

    // The list projection omits the body; the detail endpoint adds it.
    const listBody = JSON.stringify(
      document.paths[CHANGELOG_PATH]?.get?.responses["200"]
    );
    expect(listBody).toContain("excerpt");
  });
});
