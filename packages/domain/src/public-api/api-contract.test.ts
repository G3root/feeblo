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
  headers: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        required: Schema.optional(Schema.Boolean),
        schema: Schema.optional(Schema.Json),
      })
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
  security: Schema.optional(
    Schema.Array(Schema.Record(Schema.String, Schema.Array(Schema.String)))
  ),
  tags: Schema.optional(Schema.Array(Schema.String)),
});

const OpenApiDocument = Schema.Struct({
  components: Schema.optional(
    Schema.Struct({
      securitySchemes: Schema.optional(
        Schema.Record(
          Schema.String,
          Schema.Struct({
            type: Schema.String,
            description: Schema.optional(Schema.String),
            in: Schema.optional(Schema.String),
            name: Schema.optional(Schema.String),
            scheme: Schema.optional(Schema.String),
          })
        )
      ),
    })
  ),
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
  tags: Schema.Array(Schema.Struct({ name: Schema.String })),
});

const decodeDocument = Schema.decodeUnknownSync(
  Schema.fromJsonString(OpenApiDocument)
);

const document = decodeDocument(JSON.stringify(OpenApi.fromApi(PublicApi)));

const OPERATION_METHODS = ["get", "post", "put", "patch", "delete"] as const;

/** Every operation in the document, with the path and method it sits under. */
const operations = Object.entries(document.paths).flatMap(([path, item]) =>
  OPERATION_METHODS.flatMap((method) => {
    const operation = item[method];
    return operation === undefined ? [] : [{ method, operation, path }];
  })
);

const BOARDS_PATH = "/api/v1/boards";
const BOARD_PATH = "/api/v1/boards/{boardId}";
const LIST_PATH = "/api/v1/boards/{boardId}/posts";
const POSTS_PATH = "/api/v1/posts";
const RETRIEVE_PATH = "/api/v1/posts/retrieve";
const DETAIL_PATH = "/api/v1/posts/{postId}";
const POST_ACTIVITY_PATH = "/api/v1/posts/{postId}/activity";
const SET_POST_TAGS_PATH = "/api/v1/posts/{postId}/tags";
const STATUSES_PATH = "/api/v1/statuses";
const TAGS_PATH = "/api/v1/tags";
const TAG_PATH = "/api/v1/tags/{tagId}";
const COMPANIES_PATH = "/api/v1/companies";
const COMPANY_PATH = "/api/v1/companies/{companyId}";
const CHANGELOG_PATH = "/api/v1/changelog";
const CHANGELOG_ENTRY_PATH = "/api/v1/changelog/{changelogId}";
const POST_COMMENTS_PATH = "/api/v1/posts/{postId}/comments";
const COMMENT_PATH = "/api/v1/comments/{commentId}";
const PIN_COMMENT_PATH = "/api/v1/comments/{commentId}/pin";
const UNPIN_COMMENT_PATH = "/api/v1/comments/{commentId}/unpin";

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
        BOARDS_PATH,
        BOARD_PATH,
        LIST_PATH,
        POSTS_PATH,
        RETRIEVE_PATH,
        CHANGELOG_PATH,
        CHANGELOG_ENTRY_PATH,
        DETAIL_PATH,
        POST_ACTIVITY_PATH,
        SET_POST_TAGS_PATH,
        STATUSES_PATH,
        POST_COMMENTS_PATH,
        COMMENT_PATH,
        PIN_COMMENT_PATH,
        UNPIN_COMMENT_PATH,
        TAGS_PATH,
        TAG_PATH,
        COMPANIES_PATH,
        COMPANY_PATH,
      ].sort()
    );
  });

  it("categorizes every endpoint under its resource's tag", () => {
    // The group is the category: Effect derives an operation's tags from its
    // group and never from the endpoint's own annotations, so two resources in
    // one group are two resources in one sidebar section. One tag per
    // operation is what puts it in exactly one section, and the tag list is
    // what puts the sections in a deliberate order rather than the order the
    // endpoints happen to be declared in.
    expect(document.tags.map((tag) => tag.name)).toEqual([
      "Boards",
      "Changelog",
      "Comments",
      "Companies",
      "Posts",
      "Statuses",
      "Tags",
    ]);

    for (const { method, operation, path } of operations) {
      expect(operation.tags, `${method.toUpperCase()} ${path}`).toHaveLength(1);
    }

    // Every tag an operation carries is one of the sections above: a group
    // added to the API without being named there would be a seventh section
    // that this list does not describe.
    expect(
      [
        ...new Set(operations.flatMap(({ operation }) => operation.tags ?? [])),
      ].sort()
    ).toEqual([
      "Boards",
      "Changelog",
      "Comments",
      "Companies",
      "Posts",
      "Statuses",
      "Tags",
    ]);
  });

  it("gates every published endpoint on a key and a plan", () => {
    // The key middleware is what checks the key, the workspace's plan, and the
    // endpoint's scope, and it is applied per group, so a resource split into
    // a group that forgets it would publish endpoints open to anyone. Nothing
    // in the type system catches that: the group bakes the middleware into its
    // endpoints, so `HandlerOf` and `handleAll` lose the middleware's failures
    // together and still agree. The document is where the invariant is
    // observable, so it is asserted here.
    for (const { method, operation, path } of operations) {
      const where = `${method.toUpperCase()} ${path}`;
      expect(Object.keys(operation.responses), where).toEqual(
        expect.arrayContaining(["401", "403", "429"])
      );

      const body = JSON.stringify(operation.responses);
      expect(body, where).toContain("MISSING_API_KEY");
      expect(body, where).toContain("PLAN_REQUIRES_UPGRADE");
      expect(body, where).toContain("RATE_LIMITED");
    }
  });

  it("declares the api-key credential on every published operation", () => {
    // The requirement is what puts the Authorize button and the per-operation
    // lock on the published reference, and what makes a client generated from
    // this document send the key. The middleware carries the scheme, so a
    // group added without `ApiKeyAuthMiddleware` would drop it — and would
    // also fall out of the "gates every published endpoint" test below, since
    // that middleware is what declares the 401 responses.
    const securitySchemes = document.components?.securitySchemes ?? undefined;
    expect(securitySchemes).toBeDefined();
    expect(securitySchemes?.["apiKey"]).toEqual({
      description: "A workspace API key, presented in the x-api-key header.",
      in: "header",
      name: "x-api-key",
      type: "apiKey",
    });

    for (const { method, operation, path } of operations) {
      expect(operation.security, `${method.toUpperCase()} ${path}`).toEqual([
        { apiKey: [] },
      ]);
    }
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
    // at runtime in `api-live.test.ts`; the middleware attaches it through
    // `HttpApiSchema.WithHeaders`, and the document reflects it, so a caller
    // can see it before it happens. The budget headers travel with it, so a
    // client generated from this document can pace itself on a success and a
    // refusal alike.
    expect(JSON.stringify(responses["429"])).toContain("RATE_LIMITED");
    expect(responses["429"]?.headers?.["retry-after"]).toEqual({
      schema: { type: "string" },
      required: true,
    });

    for (const header of [
      "x-ratelimit-limit",
      "x-ratelimit-remaining",
      "x-ratelimit-reset",
    ]) {
      expect(responses["429"]?.headers?.[header]).toEqual({
        schema: { type: "string" },
        required: true,
      });
    }
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

    // The list is the workspace-wide page: the board's list plus the board
    // filter itself, and the filters an integration syncs with.
    const listParameters = (
      document.paths[POSTS_PATH]?.get?.parameters ?? []
    ).map((parameter) => parameter.name);
    expect(listParameters.sort()).toEqual([
      "boardId",
      "cursor",
      "includeArchived",
      "limit",
      "status",
      "tagIds",
      "updatedAfter",
    ]);

    // A board's list names its board through the path rather than a query
    // parameter, and takes the same filters otherwise; the document reports
    // both forms as parameters, which is why the two name lists agree.
    const boardListParameters = (
      document.paths[LIST_PATH]?.get?.parameters ?? []
    ).map((parameter) => parameter.name);
    expect(boardListParameters.sort()).toEqual([
      "boardId",
      "cursor",
      "includeArchived",
      "limit",
      "status",
      "tagIds",
      "updatedAfter",
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

    // The endpoint is documented under the resource it writes — a post — not
    // under Tags: the group is the section a customer reads, and setting a
    // post's tags writes the post.
    expect(operation?.tags).toEqual(["Posts"]);
    expect(JSON.stringify(operation?.requestBody)).toContain("tagIds");

    // The response is the post's tag references, not the tag resource: no slug
    // and no timestamps, which a caller reads from the tag itself.
    const body = JSON.stringify(responses["200"]);
    expect(body).toContain("data");
    expect(body).toContain("name");
    expect(body).not.toContain("slug");
    expect(body).not.toContain("createdAt");
  });

  it("documents the status catalog as a complete ordered list", () => {
    const responses = document.paths[STATUSES_PATH]?.get?.responses ?? {};

    // A status read has no input to get wrong and nothing to collide with, so
    // it answers the read vocabulary and never a conflict.
    expect(Object.keys(responses).sort()).toEqual(READ_RESPONSE_CODES);
    expect(JSON.stringify(responses)).not.toContain("CONFLICT");

    const body = JSON.stringify(responses["200"]);
    for (const field of ["id", "name", "type", "orderIndex", "color"]) {
      expect(body).toContain(field);
    }

    // `post_status` also carries the workspace; the key already names it.
    expect(body).not.toContain("organizationId");

    // Deliberately not a page: a workspace has a handful of statuses, ordered
    // by the workspace's own `orderIndex` rather than by age, so a cursor on
    // the shared `(createdAt, id)` tuple would order them the wrong way.
    expect(body).not.toContain("nextCursor");
  });

  it("documents the post timeline without an internal actor identifier", () => {
    const responses = document.paths[POST_ACTIVITY_PATH]?.get?.responses ?? {};

    // Reading a post's history is a read: it cannot collide with anything, and
    // it can report a missing post.
    expect(Object.keys(responses).sort()).toEqual(READ_RESPONSE_CODES);
    expect(JSON.stringify(responses)).not.toContain("CONFLICT");

    const body = JSON.stringify(responses["200"]);
    for (const field of [
      "id",
      "kind",
      "actor",
      "previousValue",
      "nextValue",
      "commentId",
      "createdAt",
      "nextCursor",
    ]) {
      expect(body).toContain(field);
    }

    // `post_activity` also carries the workspace, the actor's user and member
    // ids, and the on-behalf metadata; none of them has a name in this
    // contract, and the key already names the workspace.
    for (const forbidden of [
      "organizationId",
      "actorId",
      "actorMemberId",
      "metadata",
      "postId",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it("documents the board resource without an internal identifier", () => {
    const listResponses = document.paths[BOARDS_PATH]?.get?.responses ?? {};
    const getResponses = document.paths[BOARD_PATH]?.get?.responses ?? {};

    // Both read a board, so neither promises a conflict and neither can answer
    // a missing-resource status it never returns.
    expect(Object.keys(listResponses).sort()).toEqual(READ_RESPONSE_CODES);
    expect(Object.keys(getResponses).sort()).toEqual(READ_RESPONSE_CODES);
    expect(JSON.stringify(listResponses)).not.toContain("CONFLICT");
    expect(JSON.stringify(getResponses)).not.toContain("CONFLICT");

    const listBody = JSON.stringify(listResponses["200"]);
    expect(listBody).toContain("nextCursor");

    const body = JSON.stringify(getResponses["200"]);
    for (const field of [
      "id",
      "name",
      "slug",
      "visibility",
      "url",
      "createdAt",
      "updatedAt",
    ]) {
      expect(body).toContain(field);
    }

    // `board` also carries the workspace and the member who created it; the
    // key already names the workspace, so neither has a name in this contract.
    for (const forbidden of [
      "organizationId",
      "creatorId",
      "creatorMemberId",
    ]) {
      expect(body).not.toContain(forbidden);
    }
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

  it("documents the comment resource without an internal identifier", () => {
    const createOperation = document.paths[POST_COMMENTS_PATH]?.post;
    const createResponses = createOperation?.responses ?? {};
    const body = JSON.stringify(createResponses["201"]);

    for (const field of [
      "id",
      "postId",
      "content",
      "visibility",
      "parentCommentId",
      "pinnedAt",
      "author",
      "createdAt",
      "updatedAt",
    ]) {
      expect(body).toContain(field);
    }

    // `comment` also carries `userId` and `memberId`, the actor identifiers
    // the post payloads already keep out, plus the merge and status-transition
    // provenance a comment resource does not need.
    for (const forbidden of [
      "userId",
      "memberId",
      "organizationId",
      "mergedFromPostId",
      "statusUpdateId",
    ]) {
      expect(body).not.toContain(forbidden);
    }

    // The create names the customer the comment is attributed to; an API key
    // has no user of its own, so the field is required rather than optional.
    const requestBody = JSON.stringify(createOperation?.requestBody);
    expect(requestBody).toContain("author");
    expect(requestBody).toContain("content");
  });

  it("documents the comment endpoints' statuses, and no conflict on a read", () => {
    const listResponses =
      document.paths[POST_COMMENTS_PATH]?.get?.responses ?? {};
    const createResponses =
      document.paths[POST_COMMENTS_PATH]?.post?.responses ?? {};
    const getResponses = document.paths[COMMENT_PATH]?.get?.responses ?? {};
    const updateResponses =
      document.paths[COMMENT_PATH]?.patch?.responses ?? {};
    const deleteResponses =
      document.paths[COMMENT_PATH]?.delete?.responses ?? {};
    const pinResponses =
      document.paths[PIN_COMMENT_PATH]?.post?.responses ?? {};
    const unpinResponses =
      document.paths[UNPIN_COMMENT_PATH]?.post?.responses ?? {};

    expect(Object.keys(listResponses).sort()).toEqual(READ_RESPONSE_CODES);
    expect(Object.keys(getResponses).sort()).toEqual(READ_RESPONSE_CODES);
    expect(Object.keys(pinResponses).sort()).toEqual(READ_RESPONSE_CODES);
    expect(Object.keys(unpinResponses).sort()).toEqual(READ_RESPONSE_CODES);

    // A create answers 404 — the post it comments on has to exist — and 409
    // when that post's conversation is locked. An update and a delete cannot
    // collide with anything, so they promise neither.
    expect(Object.keys(createResponses).sort()).toEqual([
      "201",
      "400",
      "401",
      "403",
      "404",
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
    expect(JSON.stringify(listResponses)).not.toContain("CONFLICT");
    expect(JSON.stringify(getResponses)).not.toContain("CONFLICT");
    expect(JSON.stringify(pinResponses)).not.toContain("CONFLICT");
    expect(JSON.stringify(updateResponses)).not.toContain("CONFLICT");
  });
});
