import { NodeHttpPlatform, NodeServices } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { slugify } from "@feeblo/utils/url";
import { eq } from "drizzle-orm";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Etag from "effect/unstable/http/Etag";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import type { ApiKeyAuthRecord } from "../api-key/schema";
import { Auth } from "../auth-handler";
import { EntitlementPolicy } from "../entitlement/policies";
import { PolicyDeniedError } from "../policy";
import { PostActivityRepository } from "../post-activity/repository";
import { RateLimitService } from "../rate-limit/service";
import { WorkspaceRepository } from "../workspace/repository";
import { PublicApiConfig } from "./config";
import {
  makeApiKeyAuthMiddlewareLive,
  PUBLIC_API_KEY_RATE_LIMIT,
} from "./middleware";
import { PublicApiRepository } from "./repository";
import { makePublicApiRoute } from "./router";
import {
  PublicApiCompany,
  PublicApiCompanyPage,
  PublicApiPost,
  PublicApiPostPage,
  PublicApiPostTags,
  PublicApiTagDetail,
  PublicApiTagPage,
} from "./schema";

/**
 * HTTP-level tests for `/api/v1`.
 *
 * These exercise the real route tree: the key middleware, the plan gate, the
 * per-endpoint scope check, the error envelope, and the serialized payload.
 * Response bodies are decoded rather than cast, so a payload that stops
 * satisfying the published contract fails here instead of silently satisfying
 * a hand-written annotation.
 */

/** Keys the stub verifier accepts, keyed by the presented secret. */
const acceptedKeys = new Map<string, ApiKeyAuthRecord>();

const unusedApiKeyMethod = () => () =>
  Promise.reject(new Error("Not available in this composition"));

const AuthTest = Layer.succeed(Auth, {
  handler: () => new Response(),
  api: {
    getSession: async () => null,
    createApiKey: unusedApiKeyMethod(),
    verifyApiKey: async ({ body }) => {
      if (body.key === "fbk_verifier_failure") {
        // A verifier/database rejection carrying detail that must not reach
        // the client, only the server-side log.
        throw new Error("connection failed: password=secret");
      }

      const record = acceptedKeys.get(body.key);
      return record === undefined
        ? { valid: false as const, key: null }
        : { valid: true as const, key: record };
    },
  },
});

const ErrorEnvelope = Schema.Struct({
  _tag: Schema.String,
  message: Schema.String,
});

const OpenApiDocument = Schema.Struct({
  paths: Schema.Record(Schema.String, Schema.Json),
});

const decodeError = Schema.decodeUnknownSync(
  Schema.fromJsonString(ErrorEnvelope)
);
const decodePage = Schema.decodeUnknownSync(
  Schema.fromJsonString(PublicApiPostPage)
);
const decodePost = Schema.decodeUnknownSync(
  Schema.fromJsonString(PublicApiPost)
);
const decodePostTags = Schema.decodeUnknownSync(
  Schema.fromJsonString(PublicApiPostTags)
);
const decodeTag = Schema.decodeUnknownSync(
  Schema.fromJsonString(PublicApiTagDetail)
);
const decodeTagPage = Schema.decodeUnknownSync(
  Schema.fromJsonString(PublicApiTagPage)
);
const decodeCompany = Schema.decodeUnknownSync(
  Schema.fromJsonString(PublicApiCompany)
);
const decodeCompanyPage = Schema.decodeUnknownSync(
  Schema.fromJsonString(PublicApiCompanyPage)
);
const decodeDocument = Schema.decodeUnknownSync(
  Schema.fromJsonString(OpenApiDocument)
);

/**
 * Handler dependencies, supplied from outside the route layer.
 *
 * `crmEntryLimit` wraps the real plan policy in one that refuses a create once
 * the workspace holds that many CRM entries: no plan both allows the Public API
 * and carries a cap today, so that branch is unreachable through the real
 * entitlements. Wrapping rather than restating the policy keeps every other
 * decision the real one — the key still has to pass the real `canUsePublicApi`.
 */
const makePublicApiDependencies = (
  options: { readonly crmEntryLimit?: number } = {}
) => {
  // Destructured so the closure below captures a narrowed `const` rather than
  // re-reading an optional property.
  const { crmEntryLimit } = options;

  return Layer.mergeAll(
    // The Public API records tag changes in a post's timeline, so its repository
    // needs the activity repository at construction time.
    PublicApiRepository.layer.pipe(Layer.provide(PostActivityRepository.layer)),
    PublicApiConfig.layerTest(new URL("https://app.feeblo.test")),
    crmEntryLimit === undefined
      ? EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer))
      : Layer.effect(
          EntitlementPolicy,
          Effect.map(EntitlementPolicy, (policy) => ({
            ...policy,
            canCreateCrmEntry: ({ crmEntryCount }) =>
              Effect.gen(function* () {
                const count = yield* crmEntryCount;
                if (count >= crmEntryLimit) {
                  return yield* Effect.fail(
                    new PolicyDeniedError({ reason: "The plan has no room." })
                  );
                }
              }),
          }))
        ).pipe(
          Layer.provide(
            EntitlementPolicy.layer.pipe(
              Layer.provide(WorkspaceRepository.layer)
            )
          )
        ),
    WorkspaceRepository.layer,
    AuthTest,
    RateLimitService.layerMemory,
    Etag.layer,
    NodeHttpPlatform.layer,
    NodeServices.layer
    // Merged so test bodies can seed fixtures through `currentDb`.
  ).pipe(Layer.provideMerge(Database.PgliteDatabaseLive));
};

const PublicApiDependencies = makePublicApiDependencies();

/** Wiring whose plan refuses every create: the cap is already reached at zero. */
const CrmEntryDeniedDependencies = makePublicApiDependencies({
  crmEntryLimit: 0,
});

/** Wiring whose plan has room for exactly one CRM entry. */
const CrmEntryCapOneDependencies = makePublicApiDependencies({
  crmEntryLimit: 1,
});

/**
 * Builds the app under test.
 *
 * The rate limit is a parameter so one suite can exhaust it in two requests;
 * everything else is the production wiring.
 */
const makeTestApp = (
  rateLimit: {
    readonly limit: number;
    readonly window: Duration.Input;
  } = PUBLIC_API_KEY_RATE_LIMIT
) =>
  makePublicApiRoute(makeApiKeyAuthMiddlewareLive(rateLimit)).pipe(
    Layer.provideMerge(PublicApiDependencies),
    Layer.provideMerge(HttpRouter.layer)
  );

/**
 * Builds and runs one request through the real router.
 *
 * The method and body are parameters rather than separate helpers per verb so
 * a read and a write differ only in what the caller passes, and a new endpoint
 * cannot arrive with its own slightly different request construction.
 */
const execute = (
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  options: { readonly apiKey?: string; readonly body?: unknown } = {}
) => {
  const headers: Record<string, string> = {};
  if (options.apiKey !== undefined) {
    headers["x-api-key"] = options.apiKey;
  }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  const init: RequestInit = { method, headers };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }

  const request = HttpServerRequest.fromWeb(
    new Request(`http://localhost${path}`, init)
  );
  return Effect.flatMap(HttpRouter.HttpRouter, (router) =>
    router.asHttpEffect()
  ).pipe(Effect.provideService(HttpServerRequest.HttpServerRequest, request));
};

/** A GET: every read endpoint. */
const executeRequest = (path: string, apiKey?: string) =>
  execute("GET", path, apiKey === undefined ? {} : { apiKey });

/** A write, with the JSON body the contract declares. */
const executeWrite = (
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  options: { readonly apiKey: string; readonly body?: unknown }
) => execute(method, path, options);

const responseBody = (response: HttpServerResponse.HttpServerResponse) => {
  const body = response.body;
  return body._tag === "Uint8Array" ? new TextDecoder().decode(body.body) : "";
};

type SeededWorkspace = {
  boardId: string;
  organizationId: string;
  postId: string;
  statusId: string;
};

/**
 * Inserts a tag directly, so a test controls its name and its age.
 *
 * Goes through the same `slugify` the repository uses, so a fixture cannot
 * disagree with the API about what a tag's slug is.
 */
const seedTag = (
  organizationId: string,
  id: string,
  name: string,
  createdAt: Date = new Date()
) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    yield* db.insert(schema.tagTable).values({
      id,
      name,
      slug: slugify(name),
      organizationId,
      createdAt,
      updatedAt: createdAt,
    });
    return id;
  });

/**
 * Inserts a company directly, so a test controls its name, its external id, and
 * its age. `source` is left to the column's own default, which is what a
 * dashboard-created row looks like.
 */
const seedCompany = (
  organizationId: string,
  id: string,
  name: string,
  options: {
    readonly avatar?: string | null;
    readonly createdAt?: Date;
    readonly externalId?: string | null;
  } = {}
) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const createdAt = options.createdAt ?? new Date();
    yield* db.insert(schema.companyTable).values({
      id,
      name,
      externalId: options.externalId ?? null,
      avatar: options.avatar ?? null,
      organizationId,
      createdAt,
      updatedAt: createdAt,
    });
    return id;
  });

const seedWorkspace = (
  options: {
    readonly plan?: "free" | "starter";
    readonly includeArchivedPost?: boolean;
    readonly postCount?: number;
    readonly withVotesAndComments?: boolean;
  } = {}
) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const organizationId = `org_${Math.random().toString(36).slice(2, 10)}`;
    const boardId = `brd_${organizationId}`;
    const statusId = `pss_${organizationId}`;
    const postId = `pst_${organizationId}`;
    const now = new Date();

    yield* db.insert(schema.organizationTable).values({
      id: organizationId,
      name: "Test Workspace",
      slug: organizationId,
      createdAt: now,
    });

    yield* db.insert(schema.boardTable).values({
      id: boardId,
      name: "Feedback",
      slug: "feedback",
      visibility: "PUBLIC",
      organizationId,
      createdAt: now,
    });

    yield* db.insert(schema.postStatusTable).values({
      id: statusId,
      type: "PLANNED",
      label: "Planned",
      orderIndex: 0,
      organizationId,
      createdAt: now,
    });

    const postCount = options.postCount ?? 1;
    for (let index = 0; index < postCount; index += 1) {
      yield* db.insert(schema.postTable).values({
        id: index === 0 ? postId : `${postId}_${index}`,
        title: `Post ${index}`,
        slug: `post-${index}`,
        content: "<p>Sanitized body</p>",
        excerpt: `Excerpt ${index}`,
        boardId,
        statusId,
        organizationId,
        // Oldest first, so the list order is deterministic.
        createdAt: new Date(now.getTime() - index * 60_000),
        updatedAt: now,
      });
    }

    if (options.withVotesAndComments === true) {
      yield* db.insert(schema.userTable).values({
        id: `user_voter_${organizationId}`,
        email: `voter_${organizationId}@example.com`,
        name: "Voter",
      });
      yield* db.insert(schema.upvoteTable).values({
        id: `upv_${organizationId}`,
        userId: `user_voter_${organizationId}`,
        postId,
        organizationId,
        createdAt: now,
      });
      yield* db.insert(schema.commentTable).values([
        {
          id: `cmt_public_${organizationId}`,
          content: "public",
          organizationId,
          postId,
          userId: `user_voter_${organizationId}`,
          visibility: "PUBLIC",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: `cmt_internal_${organizationId}`,
          content: "internal",
          organizationId,
          postId,
          userId: `user_voter_${organizationId}`,
          visibility: "INTERNAL",
          createdAt: now,
          updatedAt: now,
        },
      ]);
    }

    if (options.includeArchivedPost === true) {
      yield* db.insert(schema.postTable).values({
        id: `${postId}_archived`,
        title: "Archived",
        slug: "archived",
        content: "<p>Archived body</p>",
        excerpt: "Archived",
        boardId,
        statusId,
        organizationId,
        archivedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    if ((options.plan ?? "starter") === "starter") {
      yield* db.insert(schema.productTable).values({
        id: `product_${organizationId}`,
        name: "Starter",
        isRecurring: true,
        isArchived: false,
        externalOrganizationId: "polar-org",
        visibility: "public",
        metadata: { plan: "starter", variant: "monthly" },
      });
      yield* db.insert(schema.subscriptionTable).values({
        id: `subscription_${organizationId}`,
        externalId: `polar_${organizationId}`,
        organizationId,
        amount: 1900,
        cancelAtPeriodEnd: false,
        currency: "usd",
        recurringInterval: "month",
        recurringIntervalCount: 1,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        customerId: `polar_customer_${organizationId}`,
        productId: `product_${organizationId}`,
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      boardId,
      organizationId,
      postId,
      statusId,
    } satisfies SeededWorkspace;
  });

/**
 * The scopes a key is created with today, plus the tag writes the dashboard
 * grants explicitly. Written out rather than imported so the tests pin the
 * vocabulary instead of tracking it.
 */
const READ_KEY_SCOPES = {
  boards: ["read"],
  posts: ["read"],
  tags: ["read"],
};

const TAG_MANAGEMENT_KEY_SCOPES = {
  boards: ["read"],
  posts: ["read"],
  tags: ["read", "create", "update", "delete", "assign"],
};

/**
 * The CRM grant, which is not implied by the read scopes: a key minted to read
 * feedback does not learn the workspace's customers.
 */
const COMPANY_MANAGEMENT_KEY_SCOPES = {
  boards: ["read"],
  posts: ["read"],
  tags: ["read"],
  companies: ["read", "create", "update", "delete"],
};

const registerKey = (
  secret: string,
  organizationId: string,
  permissions: {
    readonly [resource: string]: readonly string[];
  } | null = READ_KEY_SCOPES
) => {
  acceptedKeys.set(secret, {
    id: `apikey_${secret}`,
    name: "Test key",
    start: "fbk_ab",
    prefix: "fbk_",
    enabled: true,
    createdAt: new Date(),
    lastRequest: null,
    expiresAt: null,
    referenceId: organizationId,
    permissions,
  });
};

layer(makeTestApp())("public api v1", (it) => {
  it.effect("rejects a request with no key", () =>
    Effect.gen(function* () {
      const response = yield* executeRequest("/api/v1/posts/pst_whatever");

      expect(response.status).toBe(401);
      const body = decodeError(responseBody(response));
      expect(body._tag).toBe("MISSING_API_KEY");
      // The envelope is exactly the tag and a human message.
      expect(Object.keys(body).sort()).toEqual(["_tag", "message"]);
    })
  );

  it.effect("rejects an unknown key", () =>
    Effect.gen(function* () {
      const response = yield* executeRequest(
        "/api/v1/posts/pst_whatever",
        "fbk_not_a_key"
      );

      expect(response.status).toBe(401);
      expect(decodeError(responseBody(response))._tag).toBe("INVALID_API_KEY");
    })
  );

  it.effect("does not leak verification failures to the client", () =>
    Effect.gen(function* () {
      const response = yield* executeRequest(
        "/api/v1/posts/pst_whatever",
        "fbk_verifier_failure"
      );

      expect(response.status).toBe(500);
      const raw = responseBody(response);
      const body = decodeError(raw);
      expect(body._tag).toBe("INTERNAL_ERROR");
      // The fixed public message, never the library or database detail.
      expect(body.message).toBe("The request could not be completed.");
      expect(raw).not.toContain("password=secret");
    })
  );

  it.effect("refuses a workspace on the free plan", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace({ plan: "free" });
      registerKey("fbk_free_plan", workspace.organizationId);

      const response = yield* executeRequest(
        `/api/v1/posts/${workspace.postId}`,
        "fbk_free_plan"
      );

      expect(response.status).toBe(403);
      expect(decodeError(responseBody(response))._tag).toBe(
        "PLAN_REQUIRES_UPGRADE"
      );
    })
  );

  it.effect("refuses a key without the posts.read scope", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey("fbk_boards_only", workspace.organizationId, {
        boards: ["read"],
      });

      const response = yield* executeRequest(
        `/api/v1/posts/${workspace.postId}`,
        "fbk_boards_only"
      );

      expect(response.status).toBe(403);
      const body = decodeError(responseBody(response));
      expect(body._tag).toBe("FORBIDDEN_SCOPE");
      expect(body.message).toContain("posts.read");
    })
  );

  it.effect("reports another workspace's post as not found", () =>
    Effect.gen(function* () {
      const mine = yield* seedWorkspace();
      const theirs = yield* seedWorkspace();
      registerKey("fbk_mine", mine.organizationId);
      registerKey("fbk_theirs", theirs.organizationId);

      const response = yield* executeRequest(
        `/api/v1/posts/${theirs.postId}`,
        "fbk_mine"
      );

      // 404 rather than 403: a 403 would confirm the id exists elsewhere.
      expect(response.status).toBe(404);
      expect(decodeError(responseBody(response))._tag).toBe("NOT_FOUND");
    })
  );

  it.effect("reports another workspace's board as not found", () =>
    Effect.gen(function* () {
      const mine = yield* seedWorkspace();
      const theirs = yield* seedWorkspace();
      registerKey("fbk_board_mine", mine.organizationId);
      registerKey("fbk_board_theirs", theirs.organizationId);

      const response = yield* executeRequest(
        `/api/v1/boards/${theirs.boardId}/posts`,
        "fbk_board_mine"
      );

      // 404 rather than a successful empty page: the two must not look alike,
      // and a 403 would confirm the id exists in another workspace.
      expect(response.status).toBe(404);
      expect(decodeError(responseBody(response))._tag).toBe("NOT_FOUND");
    })
  );

  it.effect("reports an unknown board as not found", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey("fbk_board_missing", workspace.organizationId);

      const response = yield* executeRequest(
        "/api/v1/boards/brd_does_not_exist/posts",
        "fbk_board_missing"
      );

      expect(response.status).toBe(404);
      expect(decodeError(responseBody(response))._tag).toBe("NOT_FOUND");
    })
  );

  it.effect("rejects a malformed limit and a malformed cursor", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey("fbk_limits", workspace.organizationId);

      const badLimit = yield* executeRequest(
        `/api/v1/boards/${workspace.boardId}/posts?limit=abc`,
        "fbk_limits"
      );
      expect(badLimit.status).toBe(400);
      expect(decodeError(responseBody(badLimit))._tag).toBe("INVALID_REQUEST");

      const tooLarge = yield* executeRequest(
        `/api/v1/boards/${workspace.boardId}/posts?limit=101`,
        "fbk_limits"
      );
      expect(tooLarge.status).toBe(400);

      const badCursor = yield* executeRequest(
        `/api/v1/boards/${workspace.boardId}/posts?cursor=not-a-cursor`,
        "fbk_limits"
      );
      expect(badCursor.status).toBe(400);
      expect(decodeError(responseBody(badCursor))._tag).toBe("INVALID_REQUEST");
    })
  );

  it.effect("returns a page with the documented values and no identity", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace({
        postCount: 3,
        withVotesAndComments: true,
      });
      registerKey("fbk_happy", workspace.organizationId);

      const response = yield* executeRequest(
        `/api/v1/boards/${workspace.boardId}/posts?limit=2`,
        "fbk_happy"
      );

      expect(response.status).toBe(200);
      const body = decodePage(responseBody(response));

      expect(body.data).toHaveLength(2);
      expect(body.nextCursor).toBeTypeOf("string");

      // The field set is locked by the OpenAPI contract test, which reads the
      // schemas the encoder uses; here the values are asserted.
      const raw = responseBody(response);
      expect(raw).not.toContain("creatorId");
      expect(raw).not.toContain("creatorMemberId");
      expect(raw).not.toContain("@example.com");

      const first = body.data.at(0);
      expect(first).toBeDefined();
      if (first === undefined) {
        return;
      }

      expect(first.url).toContain("https://app.feeblo.test/");
      expect(first.status.name).toBe("Planned");
      expect(first.voteCount).toBe(1);
      // Internal comments are not counted: this must agree with the portal.
      expect(first.commentCount).toBe(1);
      expect(Object.keys(first.author).sort()).toEqual([
        "avatarUrl",
        "displayName",
        "type",
      ]);
    })
  );

  it.effect(
    "paginates with a cursor and excludes archived posts by default",
    () =>
      Effect.gen(function* () {
        const workspace = yield* seedWorkspace({
          postCount: 2,
          includeArchivedPost: true,
        });
        registerKey("fbk_paging", workspace.organizationId);

        const firstPage = yield* executeRequest(
          `/api/v1/boards/${workspace.boardId}/posts?limit=1`,
          "fbk_paging"
        );
        const firstBody = decodePage(responseBody(firstPage));
        expect(firstBody.data).toHaveLength(1);
        expect(firstBody.nextCursor).not.toBeNull();

        const secondPage = yield* executeRequest(
          `/api/v1/boards/${workspace.boardId}/posts?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor ?? "")}`,
          "fbk_paging"
        );
        const secondBody = decodePage(responseBody(secondPage));

        expect(secondBody.data).toHaveLength(1);
        // No repeat and no skip across pages.
        expect(secondBody.data.at(0)?.id).not.toBe(firstBody.data.at(0)?.id);
        expect(secondBody.nextCursor).toBeNull();

        const withArchived = yield* executeRequest(
          `/api/v1/boards/${workspace.boardId}/posts?includeArchived=true`,
          "fbk_paging"
        );
        const archivedBody = decodePage(responseBody(withArchived));
        expect(archivedBody.data).toHaveLength(3);
        expect(archivedBody.data.some((post) => post.archivedAt !== null)).toBe(
          true
        );
      })
  );

  it.effect("returns a post's body on the detail endpoint only", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey("fbk_detail", workspace.organizationId);

      const response = yield* executeRequest(
        `/api/v1/posts/${workspace.postId}`,
        "fbk_detail"
      );

      expect(response.status).toBe(200);
      const body = decodePost(responseBody(response));
      expect(body.content).toBe("<p>Sanitized body</p>");

      const list = yield* executeRequest(
        `/api/v1/boards/${workspace.boardId}/posts`,
        "fbk_detail"
      );
      const listBody = decodePage(responseBody(list));
      // Only the detail projection carries `content`.
      expect(listBody.data.at(0)).not.toHaveProperty("content");
    })
  );

  it.effect(
    "lists a workspace's tags newest first, and pages with a cursor",
    () =>
      Effect.gen(function* () {
        const workspace = yield* seedWorkspace();
        const now = Date.now();
        // Oldest first, so the expected page order is deterministic.
        yield* seedTag(
          workspace.organizationId,
          "tag_old",
          "Old",
          new Date(now - 60_000)
        );
        yield* seedTag(
          workspace.organizationId,
          "tag_new",
          "New",
          new Date(now)
        );
        registerKey("fbk_tags_read", workspace.organizationId);

        const first = yield* executeRequest(
          "/api/v1/tags?limit=1",
          "fbk_tags_read"
        );
        expect(first.status).toBe(200);
        const firstPage = decodeTagPage(responseBody(first));
        expect(firstPage.data).toHaveLength(1);
        expect(firstPage.data.at(0)?.name).toBe("New");
        expect(firstPage.nextCursor).toBeTypeOf("string");

        const second = yield* executeRequest(
          `/api/v1/tags?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`,
          "fbk_tags_read"
        );
        const secondPage = decodeTagPage(responseBody(second));
        expect(secondPage.data).toHaveLength(1);
        expect(secondPage.data.at(0)?.name).toBe("Old");
        expect(secondPage.nextCursor).toBeNull();
      })
  );

  it.effect("creates a tag, trims its name, and derives its slug", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey(
        "fbk_tags_write",
        workspace.organizationId,
        TAG_MANAGEMENT_KEY_SCOPES
      );

      const created = yield* executeWrite("POST", "/api/v1/tags", {
        apiKey: "fbk_tags_write",
        body: { name: "  UI Kit  " },
      });

      expect(created.status).toBe(201);
      const tag = decodeTag(responseBody(created));
      expect(tag.name).toBe("UI Kit");
      expect(tag.slug).toBe("ui-kit");
      // The id is minted server-side; a caller does not choose identifiers.
      expect(tag.id).toMatch(/^tag_/);

      const fetched = yield* executeRequest(
        `/api/v1/tags/${tag.id}`,
        "fbk_tags_write"
      );
      expect(fetched.status).toBe(200);
      expect(decodeTag(responseBody(fetched)).id).toBe(tag.id);
    })
  );

  it.effect("refuses a tag write without the write scope", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      yield* seedTag(workspace.organizationId, "tag_scoped", "Scoped");
      registerKey("fbk_tags_readonly", workspace.organizationId);

      const cases = [
        { method: "POST" as const, scope: "tags.create" },
        { method: "PATCH" as const, scope: "tags.update" },
        { method: "DELETE" as const, scope: "tags.delete" },
      ];

      for (const entry of cases) {
        const response = yield* executeWrite(
          entry.method,
          entry.method === "POST" ? "/api/v1/tags" : "/api/v1/tags/tag_scoped",
          { apiKey: "fbk_tags_readonly", body: { name: "Renamed" } }
        );

        expect(response.status).toBe(403);
        const body = decodeError(responseBody(response));
        expect(body._tag).toBe("FORBIDDEN_SCOPE");
        expect(body.message).toContain(entry.scope);
      }

      // A read key still reads: the write scope is the only thing missing.
      const read = yield* executeRequest(
        "/api/v1/tags/tag_scoped",
        "fbk_tags_readonly"
      );
      expect(read.status).toBe(200);
    })
  );

  it.effect("reports a duplicate tag name as a conflict", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey(
        "fbk_tags_conflict",
        workspace.organizationId,
        TAG_MANAGEMENT_KEY_SCOPES
      );

      const first = yield* executeWrite("POST", "/api/v1/tags", {
        apiKey: "fbk_tags_conflict",
        body: { name: "Bug" },
      });
      expect(first.status).toBe(201);

      const duplicate = yield* executeWrite("POST", "/api/v1/tags", {
        apiKey: "fbk_tags_conflict",
        body: { name: "Bug" },
      });
      expect(duplicate.status).toBe(409);
      expect(decodeError(responseBody(duplicate))._tag).toBe("CONFLICT");

      // A different name that slugifies to the same slug is the same
      // collision: the second index would reject it, so the first must too.
      const sameSlug = yield* executeWrite("POST", "/api/v1/tags", {
        apiKey: "fbk_tags_conflict",
        body: { name: "bug" },
      });
      expect(sameSlug.status).toBe(409);
      expect(decodeError(responseBody(sameSlug))._tag).toBe("CONFLICT");
    })
  );

  it.effect("rejects a tag name that is only whitespace", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey(
        "fbk_tags_empty",
        workspace.organizationId,
        TAG_MANAGEMENT_KEY_SCOPES
      );

      const response = yield* executeWrite("POST", "/api/v1/tags", {
        apiKey: "fbk_tags_empty",
        body: { name: "   " },
      });

      expect(response.status).toBe(400);
      expect(decodeError(responseBody(response))._tag).toBe("INVALID_REQUEST");
    })
  );

  it.effect("renames a tag, and lets a tag keep its own name", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      yield* seedTag(workspace.organizationId, "tag_rename", "Bug");
      yield* seedTag(workspace.organizationId, "tag_taken", "Feature");
      registerKey(
        "fbk_tags_rename",
        workspace.organizationId,
        TAG_MANAGEMENT_KEY_SCOPES
      );

      // Renaming to the name it already has is not a conflict with itself.
      const unchanged = yield* executeWrite(
        "PATCH",
        "/api/v1/tags/tag_rename",
        { apiKey: "fbk_tags_rename", body: { name: "Bug" } }
      );
      expect(unchanged.status).toBe(200);

      const renamed = yield* executeWrite("PATCH", "/api/v1/tags/tag_rename", {
        apiKey: "fbk_tags_rename",
        body: { name: "Defect" },
      });
      expect(renamed.status).toBe(200);
      const tag = decodeTag(responseBody(renamed));
      expect(tag.name).toBe("Defect");
      expect(tag.slug).toBe("defect");

      const taken = yield* executeWrite("PATCH", "/api/v1/tags/tag_rename", {
        apiKey: "fbk_tags_rename",
        body: { name: "Feature" },
      });
      expect(taken.status).toBe(409);
      expect(decodeError(responseBody(taken))._tag).toBe("CONFLICT");
    })
  );

  it.effect("reports another workspace's tag as not found", () =>
    Effect.gen(function* () {
      const mine = yield* seedWorkspace();
      const theirs = yield* seedWorkspace();
      yield* seedTag(theirs.organizationId, "tag_theirs", "Theirs");
      registerKey(
        "fbk_tags_mine",
        mine.organizationId,
        TAG_MANAGEMENT_KEY_SCOPES
      );
      registerKey(
        "fbk_tags_theirs",
        theirs.organizationId,
        TAG_MANAGEMENT_KEY_SCOPES
      );

      const read = yield* executeRequest(
        "/api/v1/tags/tag_theirs",
        "fbk_tags_mine"
      );
      expect(read.status).toBe(404);
      expect(decodeError(responseBody(read))._tag).toBe("NOT_FOUND");

      const rename = yield* executeWrite("PATCH", "/api/v1/tags/tag_theirs", {
        apiKey: "fbk_tags_mine",
        body: { name: "Mine now" },
      });
      expect(rename.status).toBe(404);

      const remove = yield* executeWrite("DELETE", "/api/v1/tags/tag_theirs", {
        apiKey: "fbk_tags_mine",
      });
      expect(remove.status).toBe(404);

      // The tag is untouched: the 404 is a refusal, not a report of what
      // happened, and its owner still sees it under its original name.
      const owned = yield* executeRequest(
        "/api/v1/tags/tag_theirs",
        "fbk_tags_theirs"
      );
      expect(owned.status).toBe(200);
      expect(decodeTag(responseBody(owned)).name).toBe("Theirs");
    })
  );

  it.effect("deletes a tag and removes it from every post", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      const db = yield* currentDb;
      yield* seedTag(workspace.organizationId, "tag_delete", "Remove me");
      yield* db.insert(schema.postTagTable).values({
        id: "ptg_delete",
        postId: workspace.postId,
        tagId: "tag_delete",
        organizationId: workspace.organizationId,
      });
      registerKey(
        "fbk_tags_delete",
        workspace.organizationId,
        TAG_MANAGEMENT_KEY_SCOPES
      );

      const before = yield* executeRequest(
        `/api/v1/posts/${workspace.postId}`,
        "fbk_tags_delete"
      );
      expect(decodePost(responseBody(before)).tags).toHaveLength(1);

      const removed = yield* executeWrite("DELETE", "/api/v1/tags/tag_delete", {
        apiKey: "fbk_tags_delete",
      });
      expect(removed.status).toBe(204);
      expect(responseBody(removed)).toBe("");

      const gone = yield* executeRequest(
        "/api/v1/tags/tag_delete",
        "fbk_tags_delete"
      );
      expect(gone.status).toBe(404);

      // `post_tag.tag_id` cascades, so the post stops carrying the tag and
      // the post itself is untouched.
      const after = yield* executeRequest(
        `/api/v1/posts/${workspace.postId}`,
        "fbk_tags_delete"
      );
      expect(after.status).toBe(200);
      expect(decodePost(responseBody(after)).tags).toHaveLength(0);
      expect(yield* db.select().from(schema.postTagTable)).toHaveLength(0);
    })
  );

  it.effect("sets a post's tags and answers with the tags it carries", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      yield* seedTag(workspace.organizationId, "tag_alpha", "Alpha");
      yield* seedTag(workspace.organizationId, "tag_beta", "Beta");
      registerKey(
        "fbk_tags_assign",
        workspace.organizationId,
        TAG_MANAGEMENT_KEY_SCOPES
      );

      // Sent out of order: the response is the post's own tag array, so it
      // comes back ordered by name rather than in the order it was sent.
      const set = yield* executeWrite(
        "PUT",
        `/api/v1/posts/${workspace.postId}/tags`,
        {
          apiKey: "fbk_tags_assign",
          body: { tagIds: ["tag_beta", "tag_alpha"] },
        }
      );

      expect(set.status).toBe(200);
      const assigned = decodePostTags(responseBody(set));
      expect(assigned.data).toEqual([
        { id: "tag_alpha", name: "Alpha" },
        { id: "tag_beta", name: "Beta" },
      ]);

      // The post reports the same set, in the same order.
      const post = yield* executeRequest(
        `/api/v1/posts/${workspace.postId}`,
        "fbk_tags_assign"
      );
      expect(decodePost(responseBody(post)).tags).toEqual(assigned.data);

      // A second call replaces rather than adds.
      const replaced = yield* executeWrite(
        "PUT",
        `/api/v1/posts/${workspace.postId}/tags`,
        { apiKey: "fbk_tags_assign", body: { tagIds: ["tag_beta"] } }
      );
      expect(decodePostTags(responseBody(replaced)).data).toEqual([
        { id: "tag_beta", name: "Beta" },
      ]);

      // An empty list clears the post rather than being rejected.
      const cleared = yield* executeWrite(
        "PUT",
        `/api/v1/posts/${workspace.postId}/tags`,
        { apiKey: "fbk_tags_assign", body: { tagIds: [] } }
      );
      expect(cleared.status).toBe(200);
      expect(decodePostTags(responseBody(cleared)).data).toEqual([]);
    })
  );

  it.effect("treats a repeated tag id as one tag", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      yield* seedTag(workspace.organizationId, "tag_twice", "Twice");
      registerKey(
        "fbk_tags_twice",
        workspace.organizationId,
        TAG_MANAGEMENT_KEY_SCOPES
      );

      // The ids are deduplicated before they are checked, so sending one twice
      // is one tag rather than a set that names a tag the workspace lacks.
      const response = yield* executeWrite(
        "PUT",
        `/api/v1/posts/${workspace.postId}/tags`,
        {
          apiKey: "fbk_tags_twice",
          body: { tagIds: ["tag_twice", "tag_twice"] },
        }
      );

      expect(response.status).toBe(200);
      expect(decodePostTags(responseBody(response)).data).toEqual([
        { id: "tag_twice", name: "Twice" },
      ]);
    })
  );

  it.effect("records the tag change in the post's timeline", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      const db = yield* currentDb;
      yield* seedTag(workspace.organizationId, "tag_timeline", "Timeline");
      registerKey(
        "fbk_tags_timeline",
        workspace.organizationId,
        TAG_MANAGEMENT_KEY_SCOPES
      );

      const activities = () =>
        db
          .select({
            actorId: schema.postActivityTable.actorId,
            kind: schema.postActivityTable.kind,
            nextValue: schema.postActivityTable.nextValue,
          })
          .from(schema.postActivityTable)
          .where(eq(schema.postActivityTable.postId, workspace.postId));

      yield* executeWrite("PUT", `/api/v1/posts/${workspace.postId}/tags`, {
        apiKey: "fbk_tags_timeline",
        body: { tagIds: ["tag_timeline"] },
      });

      // The actor is null: a machine key is not a member. The dashboard renders
      // those as "Someone", which is better than a post whose tags change with
      // no entry in its history at all.
      expect(yield* activities()).toEqual([
        { actorId: null, kind: "TAG_ADDED", nextValue: "tag_timeline" },
      ]);

      yield* executeWrite("PUT", `/api/v1/posts/${workspace.postId}/tags`, {
        apiKey: "fbk_tags_timeline",
        body: { tagIds: [] },
      });

      expect((yield* activities()).map((row) => row.kind).sort()).toEqual([
        "TAG_ADDED",
        "TAG_REMOVED",
      ]);

      // A set that changes nothing records nothing.
      yield* executeWrite("PUT", `/api/v1/posts/${workspace.postId}/tags`, {
        apiKey: "fbk_tags_timeline",
        body: { tagIds: [] },
      });
      expect(yield* activities()).toHaveLength(2);
    })
  );

  it.effect("refuses a tag assignment without the tags.assign scope", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      yield* seedTag(workspace.organizationId, "tag_noassign", "No assign");
      registerKey("fbk_tags_noassign", workspace.organizationId);

      const response = yield* executeWrite(
        "PUT",
        `/api/v1/posts/${workspace.postId}/tags`,
        { apiKey: "fbk_tags_noassign", body: { tagIds: ["tag_noassign"] } }
      );

      expect(response.status).toBe(403);
      const body = decodeError(responseBody(response));
      expect(body._tag).toBe("FORBIDDEN_SCOPE");
      expect(body.message).toContain("tags.assign");
    })
  );

  it.effect("rejects a tag the workspace does not have", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      const theirs = yield* seedWorkspace();
      yield* seedTag(workspace.organizationId, "tag_known", "Known");
      yield* seedTag(theirs.organizationId, "tag_foreign", "Foreign");
      registerKey(
        "fbk_tags_unknown",
        workspace.organizationId,
        TAG_MANAGEMENT_KEY_SCOPES
      );

      for (const tagIds of [
        ["tag_missing"],
        ["tag_known", "tag_missing"],
        // Another workspace's tag is unknown here, not forbidden: a distinct
        // answer would confirm that the id exists somewhere.
        ["tag_foreign"],
      ]) {
        const response = yield* executeWrite(
          "PUT",
          `/api/v1/posts/${workspace.postId}/tags`,
          { apiKey: "fbk_tags_unknown", body: { tagIds } }
        );

        expect(response.status).toBe(400);
        expect(decodeError(responseBody(response))._tag).toBe(
          "INVALID_REQUEST"
        );
      }

      // A rejected set does not partially apply: the known tag was not written.
      const post = yield* executeRequest(
        `/api/v1/posts/${workspace.postId}`,
        "fbk_tags_unknown"
      );
      expect(decodePost(responseBody(post)).tags).toEqual([]);
    })
  );

  it.effect("reports another workspace's post as not found", () =>
    Effect.gen(function* () {
      const mine = yield* seedWorkspace();
      const theirs = yield* seedWorkspace();
      yield* seedTag(mine.organizationId, "tag_mine", "Mine");
      registerKey(
        "fbk_tags_other",
        mine.organizationId,
        TAG_MANAGEMENT_KEY_SCOPES
      );
      registerKey(
        "fbk_tags_owner",
        theirs.organizationId,
        TAG_MANAGEMENT_KEY_SCOPES
      );

      const response = yield* executeWrite(
        "PUT",
        `/api/v1/posts/${theirs.postId}/tags`,
        { apiKey: "fbk_tags_other", body: { tagIds: ["tag_mine"] } }
      );

      expect(response.status).toBe(404);
      expect(decodeError(responseBody(response))._tag).toBe("NOT_FOUND");

      // The 404 is a refusal, not a report of what happened: the post is
      // untouched and its own workspace still sees it.
      const owned = yield* executeRequest(
        `/api/v1/posts/${theirs.postId}`,
        "fbk_tags_owner"
      );
      expect(owned.status).toBe(200);
      expect(decodePost(responseBody(owned)).tags).toEqual([]);
    })
  );

  it.effect("keeps the merge provenance of a tag it does not change", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace({ postCount: 2 });
      const db = yield* currentDb;
      // The second seeded post stands in for the post that was merged into
      // this one, which `merged_from_post_id` references.
      const sourcePostId = `${workspace.postId}_1`;
      yield* seedTag(workspace.organizationId, "tag_kept", "Kept");
      yield* seedTag(workspace.organizationId, "tag_added", "Added");
      yield* db.insert(schema.postTagTable).values({
        id: "ptg_merged",
        postId: workspace.postId,
        tagId: "tag_kept",
        organizationId: workspace.organizationId,
        mergedFromPostId: sourcePostId,
      });
      registerKey(
        "fbk_tags_provenance",
        workspace.organizationId,
        TAG_MANAGEMENT_KEY_SCOPES
      );

      const response = yield* executeWrite(
        "PUT",
        `/api/v1/posts/${workspace.postId}/tags`,
        {
          apiKey: "fbk_tags_provenance",
          body: { tagIds: ["tag_kept", "tag_added"] },
        }
      );
      expect(response.status).toBe(200);

      const rows = yield* db
        .select({
          id: schema.postTagTable.id,
          mergedFromPostId: schema.postTagTable.mergedFromPostId,
          tagId: schema.postTagTable.tagId,
        })
        .from(schema.postTagTable)
        .where(eq(schema.postTagTable.postId, workspace.postId));

      // The unchanged tag keeps its own row and the source it came from, so an
      // unmerge can still return it to that post. Replacing the set wholesale
      // would have cleared the provenance and stranded the tag here for good.
      const sorted = rows.sort((left, right) =>
        left.tagId.localeCompare(right.tagId)
      );
      expect(sorted).toHaveLength(2);
      expect(sorted.at(1)).toEqual({
        id: "ptg_merged",
        mergedFromPostId: sourcePostId,
        tagId: "tag_kept",
      });

      // The added tag is a new row, so it has no merge origin to keep.
      expect(sorted.at(0)?.tagId).toBe("tag_added");
      expect(sorted.at(0)?.mergedFromPostId).toBeNull();
    })
  );

  it.effect("never emits a tag's internal identifiers", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      yield* seedTag(workspace.organizationId, "tag_private", "Private");
      registerKey("fbk_tags_private", workspace.organizationId);

      const response = yield* executeRequest(
        "/api/v1/tags",
        "fbk_tags_private"
      );
      const raw = responseBody(response);

      expect(decodeTagPage(raw).data).toHaveLength(1);
      for (const forbidden of [
        "creatorId",
        "creatorMemberId",
        "organizationId",
      ]) {
        expect(raw).not.toContain(forbidden);
      }
    })
  );

  it.effect("never emits a company's internal identifiers", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      yield* seedCompany(workspace.organizationId, "cmp_private", "Private");
      registerKey(
        "fbk_companies_private",
        workspace.organizationId,
        COMPANY_MANAGEMENT_KEY_SCOPES
      );

      const response = yield* executeRequest(
        "/api/v1/companies",
        "fbk_companies_private"
      );
      const raw = responseBody(response);

      expect(decodeCompanyPage(raw).data).toHaveLength(1);
      for (const forbidden of [
        "organizationId",
        "creatorId",
        "contactId",
        // The value, not only the field name: the workspace id must not be
        // anywhere in the payload.
        workspace.organizationId,
      ]) {
        expect(raw).not.toContain(forbidden);
      }
    })
  );

  it.effect(
    "lists the workspace's companies newest first, and pages them",
    () =>
      Effect.gen(function* () {
        const workspace = yield* seedWorkspace();
        const other = yield* seedWorkspace();
        const base = Date.now();
        yield* seedCompany(workspace.organizationId, "cmp_old", "Old", {
          createdAt: new Date(base - 120_000),
        });
        yield* seedCompany(workspace.organizationId, "cmp_middle", "Middle", {
          createdAt: new Date(base - 60_000),
        });
        yield* seedCompany(workspace.organizationId, "cmp_new", "New", {
          createdAt: new Date(base),
        });
        // Another workspace's company must not appear in this workspace's page.
        yield* seedCompany(other.organizationId, "cmp_unlisted", "Unlisted");
        registerKey(
          "fbk_companies_list",
          workspace.organizationId,
          COMPANY_MANAGEMENT_KEY_SCOPES
        );

        const first = yield* executeRequest(
          "/api/v1/companies?limit=2",
          "fbk_companies_list"
        );
        expect(first.status).toBe(200);
        const firstPage = decodeCompanyPage(responseBody(first));
        expect(firstPage.data.map((company) => company.id)).toEqual([
          "cmp_new",
          "cmp_middle",
        ]);
        expect(firstPage.nextCursor).not.toBeNull();

        const second = yield* executeRequest(
          `/api/v1/companies?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`,
          "fbk_companies_list"
        );
        const secondPage = decodeCompanyPage(responseBody(second));
        expect(secondPage.data.map((company) => company.id)).toEqual([
          "cmp_old",
        ]);
        expect(secondPage.nextCursor).toBeNull();
      })
  );

  it.effect(
    "creates a company, trims its name, and records the API as its source",
    () =>
      Effect.gen(function* () {
        const workspace = yield* seedWorkspace();
        registerKey(
          "fbk_companies_write",
          workspace.organizationId,
          COMPANY_MANAGEMENT_KEY_SCOPES
        );

        const created = yield* executeWrite("POST", "/api/v1/companies", {
          apiKey: "fbk_companies_write",
          body: {
            name: "  Acme  ",
            externalId: "crm-1",
            avatar: "https://cdn.test/acme.png",
            externalCreatedAt: "2026-01-02T00:00:00.000Z",
          },
        });

        expect(created.status).toBe(201);
        const company = decodeCompany(responseBody(created));
        expect(company.name).toBe("Acme");
        expect(company.externalId).toBe("crm-1");
        expect(company.avatar).toBe("https://cdn.test/acme.png");
        expect(company.externalCreatedAt).toEqual(
          new Date("2026-01-02T00:00:00.000Z")
        );
        // The id is minted server-side; the caller's own key for the row is
        // `externalId`, not the primary key.
        expect(company.id).toMatch(/^cmp_/);
        expect(company.source).toBe("API");

        const fetched = yield* executeRequest(
          `/api/v1/companies/${company.id}`,
          "fbk_companies_write"
        );
        expect(fetched.status).toBe(200);
        expect(decodeCompany(responseBody(fetched))).toEqual(company);
      })
  );

  it.effect("rejects a company name that is only whitespace", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey(
        "fbk_companies_empty",
        workspace.organizationId,
        COMPANY_MANAGEMENT_KEY_SCOPES
      );

      const response = yield* executeWrite("POST", "/api/v1/companies", {
        apiKey: "fbk_companies_empty",
        body: { name: "   " },
      });

      expect(response.status).toBe(400);
      expect(decodeError(responseBody(response))._tag).toBe("INVALID_REQUEST");
    })
  );

  it.effect(
    "refuses a company read or write the key was not granted, and changes nothing",
    () =>
      Effect.gen(function* () {
        const workspace = yield* seedWorkspace();
        const db = yield* currentDb;
        yield* seedCompany(workspace.organizationId, "cmp_scoped", "Scoped");
        // The default grant: posts and tags, not the CRM.
        registerKey("fbk_companies_readonly", workspace.organizationId);

        const list = yield* executeRequest(
          "/api/v1/companies",
          "fbk_companies_readonly"
        );
        expect(list.status).toBe(403);
        const listError = decodeError(responseBody(list));
        expect(listError._tag).toBe("FORBIDDEN_SCOPE");
        expect(listError.message).toContain("companies.read");

        const cases = [
          {
            method: "POST" as const,
            path: "/api/v1/companies",
            scope: "companies.create",
          },
          {
            method: "PATCH" as const,
            path: "/api/v1/companies/cmp_scoped",
            scope: "companies.update",
          },
          {
            method: "DELETE" as const,
            path: "/api/v1/companies/cmp_scoped",
            scope: "companies.delete",
          },
        ];

        for (const entry of cases) {
          const response = yield* executeWrite(entry.method, entry.path, {
            apiKey: "fbk_companies_readonly",
            body: entry.method === "DELETE" ? undefined : { name: "Renamed" },
          });

          expect(response.status).toBe(403);
          const body = decodeError(responseBody(response));
          expect(body._tag).toBe("FORBIDDEN_SCOPE");
          expect(body.message).toContain(entry.scope);
        }

        // The refusals are refusals: nothing was created or renamed.
        const [row] = yield* db
          .select()
          .from(schema.companyTable)
          .where(eq(schema.companyTable.id, "cmp_scoped"));
        expect(row?.name).toBe("Scoped");
        // Scoped to this workspace: the database is shared across the tests in
        // this file, so a global count would count other tests' fixtures.
        const mine = yield* db
          .select()
          .from(schema.companyTable)
          .where(
            eq(schema.companyTable.organizationId, workspace.organizationId)
          );
        expect(mine).toHaveLength(1);
      })
  );

  it.effect(
    "reports a duplicate company name and externalId as conflicts",
    () =>
      Effect.gen(function* () {
        const workspace = yield* seedWorkspace();
        registerKey(
          "fbk_companies_conflict",
          workspace.organizationId,
          COMPANY_MANAGEMENT_KEY_SCOPES
        );

        const first = yield* executeWrite("POST", "/api/v1/companies", {
          apiKey: "fbk_companies_conflict",
          body: { name: "Acme", externalId: "crm-1" },
        });
        expect(first.status).toBe(201);

        const duplicateName = yield* executeWrite("POST", "/api/v1/companies", {
          apiKey: "fbk_companies_conflict",
          body: { name: "Acme" },
        });
        expect(duplicateName.status).toBe(409);
        const nameError = decodeError(responseBody(duplicateName));
        expect(nameError._tag).toBe("CONFLICT");
        expect(nameError.message).toContain("name");

        // The caller's own identifier is a key of its own: reusing it for a
        // differently named company is the same collision.
        const duplicateExternalId = yield* executeWrite(
          "POST",
          "/api/v1/companies",
          {
            apiKey: "fbk_companies_conflict",
            body: { name: "Acme Ltd", externalId: "crm-1" },
          }
        );
        expect(duplicateExternalId.status).toBe(409);
        expect(
          decodeError(responseBody(duplicateExternalId)).message
        ).toContain("externalId");

        // Two companies may both leave it unset: `NULL` is distinct in the
        // unique index, so an unset external id is not a collision.
        for (const name of ["No Id", "Also No Id"]) {
          const unset = yield* executeWrite("POST", "/api/v1/companies", {
            apiKey: "fbk_companies_conflict",
            body: { name },
          });
          expect(unset.status).toBe(201);
        }
      })
  );

  it.effect(
    "updates a company, clears a nullable field, and rejects an empty patch",
    () =>
      Effect.gen(function* () {
        const workspace = yield* seedWorkspace();
        yield* seedCompany(workspace.organizationId, "cmp_update", "Old", {
          avatar: "https://cdn.test/old.png",
          externalId: "crm-old",
        });
        yield* seedCompany(workspace.organizationId, "cmp_taken", "Taken");
        registerKey(
          "fbk_companies_update",
          workspace.organizationId,
          COMPANY_MANAGEMENT_KEY_SCOPES
        );

        // A body that names no field is not a write, and must not be answered
        // as one that changed nothing.
        const empty = yield* executeWrite(
          "PATCH",
          "/api/v1/companies/cmp_update",
          { apiKey: "fbk_companies_update", body: {} }
        );
        expect(empty.status).toBe(400);
        expect(decodeError(responseBody(empty))._tag).toBe("INVALID_REQUEST");

        // An omitted field is left alone; an explicit null clears it.
        const renamed = yield* executeWrite(
          "PATCH",
          "/api/v1/companies/cmp_update",
          {
            apiKey: "fbk_companies_update",
            body: { name: "  New  ", avatar: null },
          }
        );
        expect(renamed.status).toBe(200);
        const company = decodeCompany(responseBody(renamed));
        expect(company.name).toBe("New");
        expect(company.avatar).toBeNull();
        expect(company.externalId).toBe("crm-old");
        // A row the API did not create keeps the provenance it had.
        expect(company.source).toBe("DASHBOARD");

        // Renaming to the name it already has is not a conflict with itself,
        // and neither is sending back the external id it already holds.
        for (const body of [{ name: "New" }, { externalId: "crm-old" }]) {
          const unchanged = yield* executeWrite(
            "PATCH",
            "/api/v1/companies/cmp_update",
            { apiKey: "fbk_companies_update", body }
          );
          expect(unchanged.status).toBe(200);
        }

        const taken = yield* executeWrite(
          "PATCH",
          "/api/v1/companies/cmp_update",
          { apiKey: "fbk_companies_update", body: { name: "Taken" } }
        );
        expect(taken.status).toBe(409);
        expect(decodeError(responseBody(taken))._tag).toBe("CONFLICT");
      })
  );

  it.effect("reports another workspace's company as not found", () =>
    Effect.gen(function* () {
      const mine = yield* seedWorkspace();
      const theirs = yield* seedWorkspace();
      yield* seedCompany(theirs.organizationId, "cmp_theirs", "Theirs");
      registerKey(
        "fbk_companies_mine",
        mine.organizationId,
        COMPANY_MANAGEMENT_KEY_SCOPES
      );
      registerKey(
        "fbk_companies_theirs",
        theirs.organizationId,
        COMPANY_MANAGEMENT_KEY_SCOPES
      );

      const read = yield* executeRequest(
        "/api/v1/companies/cmp_theirs",
        "fbk_companies_mine"
      );
      expect(read.status).toBe(404);
      expect(decodeError(responseBody(read))._tag).toBe("NOT_FOUND");

      const rename = yield* executeWrite(
        "PATCH",
        "/api/v1/companies/cmp_theirs",
        { apiKey: "fbk_companies_mine", body: { name: "Mine now" } }
      );
      expect(rename.status).toBe(404);

      const remove = yield* executeWrite(
        "DELETE",
        "/api/v1/companies/cmp_theirs",
        { apiKey: "fbk_companies_mine" }
      );
      expect(remove.status).toBe(404);

      // The company is untouched, and its owner still sees it under its own
      // name: a 404 is a refusal, not a report of what happened.
      const owned = yield* executeRequest(
        "/api/v1/companies/cmp_theirs",
        "fbk_companies_theirs"
      );
      expect(owned.status).toBe(200);
      expect(decodeCompany(responseBody(owned)).name).toBe("Theirs");
    })
  );

  it.effect(
    "reports an update whose row vanished as not found, not as a server error",
    () =>
      Effect.gen(function* () {
        const workspace = yield* seedWorkspace();
        const repository = yield* PublicApiRepository;

        // The window the handler cannot close: it reads the company, another
        // request deletes it, and the update then matches no row. That is the
        // documented "not found" and not a driver failure, so the repository
        // reports it as the absence it is rather than as an internal error.
        const updated = yield* repository.updateCompany({
          avatar: null,
          companyId: "cmp_vanished",
          externalCreatedAt: null,
          externalId: null,
          name: "Renamed",
          organizationId: workspace.organizationId,
        });

        expect(Option.isNone(updated)).toBe(true);
      })
  );

  it.effect("deletes a company and detaches its contacts", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      const db = yield* currentDb;
      yield* seedCompany(workspace.organizationId, "cmp_delete", "Delete me");
      yield* db.insert(schema.contactTable).values({
        id: "cnt_linked",
        name: "Linked person",
        organizationId: workspace.organizationId,
        companyId: "cmp_delete",
      });
      registerKey(
        "fbk_companies_delete",
        workspace.organizationId,
        COMPANY_MANAGEMENT_KEY_SCOPES
      );

      const removed = yield* executeWrite(
        "DELETE",
        "/api/v1/companies/cmp_delete",
        { apiKey: "fbk_companies_delete" }
      );
      expect(removed.status).toBe(204);
      expect(responseBody(removed)).toBe("");

      const gone = yield* executeRequest(
        "/api/v1/companies/cmp_delete",
        "fbk_companies_delete"
      );
      expect(gone.status).toBe(404);

      // The people who belonged to the company survive it and simply stop
      // naming one: deleting an account record must not delete its contacts.
      const [contact] = yield* db
        .select()
        .from(schema.contactTable)
        .where(eq(schema.contactTable.id, "cnt_linked"));
      expect(contact?.companyId).toBeNull();
      expect(contact?.name).toBe("Linked person");
    })
  );

  it.effect(
    "answers a request its schema rejected on the published vocabulary",
    () =>
      Effect.gen(function* () {
        const workspace = yield* seedWorkspace();
        const db = yield* currentDb;
        registerKey(
          "fbk_malformed",
          workspace.organizationId,
          COMPANY_MANAGEMENT_KEY_SCOPES
        );

        // Bodies an endpoint cannot decode: a wrong type, a missing required
        // field, and an explicit null on a field that is not nullable. None of
        // these reaches a handler — the framework decodes first — so it is the
        // schema-error middleware that keeps them on the documented vocabulary
        // instead of letting the framework answer with a defect.
        const cases = [
          {
            body: { name: 123 },
            method: "POST" as const,
            path: "/api/v1/companies",
          },
          { body: {}, method: "POST" as const, path: "/api/v1/companies" },
          {
            body: { name: null },
            method: "PATCH" as const,
            path: "/api/v1/companies/cmp_any",
          },
          { body: { name: 5 }, method: "POST" as const, path: "/api/v1/tags" },
        ];

        for (const entry of cases) {
          const response = yield* executeWrite(entry.method, entry.path, {
            apiKey: "fbk_malformed",
            body: entry.body,
          });

          expect(response.status).toBe(400);
          expect(decodeError(responseBody(response))._tag).toBe(
            "INVALID_REQUEST"
          );
        }

        // Authentication runs first: a request with no key is refused before
        // its body is looked at, so this is a 401 and not a 400.
        const anonymous = yield* execute("POST", "/api/v1/companies", {
          body: { name: 123 },
        });
        expect(anonymous.status).toBe(401);
        expect(decodeError(responseBody(anonymous))._tag).toBe(
          "MISSING_API_KEY"
        );

        // None of the rejected requests wrote anything.
        const mine = yield* db
          .select()
          .from(schema.companyTable)
          .where(
            eq(schema.companyTable.organizationId, workspace.organizationId)
          );
        expect(mine).toHaveLength(0);
      })
  );

  it.effect("serves its own OpenAPI document without a key", () =>
    Effect.gen(function* () {
      const response = yield* executeRequest("/api/v1/openapi.json");

      // The document is the customer-facing reference and is public, so it must
      // not require a key.
      expect(response.status).toBe(200);
      const document = decodeDocument(responseBody(response));
      expect(Object.keys(document.paths).sort()).toEqual([
        "/api/v1/boards/{boardId}/posts",
        "/api/v1/companies",
        "/api/v1/companies/{companyId}",
        "/api/v1/posts/{postId}",
        "/api/v1/posts/{postId}/tags",
        "/api/v1/tags",
        "/api/v1/tags/{tagId}",
      ]);
    })
  );
});

/**
 * The limiter is keyed per API key, so the budget belongs to the key rather
 * than to a network address.
 */
layer(makeTestApp({ limit: 1, window: Duration.minutes(1) }))(
  "public api rate limiting",
  (it) => {
    it.effect(
      "returns 429 with Retry-After once the key's budget is spent",
      () =>
        Effect.gen(function* () {
          const workspace = yield* seedWorkspace();
          registerKey("fbk_limited", workspace.organizationId);

          const first = yield* executeRequest(
            `/api/v1/posts/${workspace.postId}`,
            "fbk_limited"
          );
          expect(first.status).toBe(200);

          const second = yield* executeRequest(
            `/api/v1/posts/${workspace.postId}`,
            "fbk_limited"
          );
          expect(second.status).toBe(429);
          expect(decodeError(responseBody(second))._tag).toBe("RATE_LIMITED");
          expect(second.headers["retry-after"]).toBeDefined();

          // A different key has its own budget.
          const other = yield* seedWorkspace();
          registerKey("fbk_unlimited", other.organizationId);
          const otherResponse = yield* executeRequest(
            `/api/v1/posts/${other.postId}`,
            "fbk_unlimited"
          );
          expect(otherResponse.status).toBe(200);
        })
    );

    it.effect(
      "spends the budget before the plan gate rejects a downgrade",
      () =>
        Effect.gen(function* () {
          const workspace = yield* seedWorkspace({ plan: "free" });
          registerKey("fbk_free_limited", workspace.organizationId);

          // The plan gate reads the database, so the first request must spend the
          // budget before the gate can reject it.
          const first = yield* executeRequest(
            `/api/v1/posts/${workspace.postId}`,
            "fbk_free_limited"
          );
          expect(first.status).toBe(403);
          expect(decodeError(responseBody(first))._tag).toBe(
            "PLAN_REQUIRES_UPGRADE"
          );

          const second = yield* executeRequest(
            `/api/v1/posts/${workspace.postId}`,
            "fbk_free_limited"
          );
          expect(second.status).toBe(429);
          expect(decodeError(responseBody(second))._tag).toBe("RATE_LIMITED");
        })
    );

    it.effect("does not spend budget on an invalid key", () =>
      Effect.gen(function* () {
        const workspace = yield* seedWorkspace();
        registerKey("fbk_valid_after_invalid", workspace.organizationId);

        const rejected = yield* executeRequest(
          `/api/v1/posts/${workspace.postId}`,
          "fbk_not_a_key"
        );
        expect(rejected.status).toBe(401);
        expect(decodeError(responseBody(rejected))._tag).toBe(
          "INVALID_API_KEY"
        );

        // An unverified key has no budget to spend, so the valid key's first
        // request still succeeds.
        const accepted = yield* executeRequest(
          `/api/v1/posts/${workspace.postId}`,
          "fbk_valid_after_invalid"
        );
        expect(accepted.status).toBe(200);
      })
    );
  }
);

/**
 * The CRM entry limit, with a plan that denies one.
 *
 * No plan both allows the Public API and carries a `crmEntries` cap — the cap
 * is on Free, which cannot create a key — so the policy is wrapped rather than
 * the request being made against a plan that does not exist. What this covers
 * is the wiring the unit test cannot: that a company create consults the plan
 * at all, answers on the published vocabulary when it refuses, and writes
 * nothing.
 */
layer(
  makePublicApiRoute(makeApiKeyAuthMiddlewareLive()).pipe(
    Layer.provideMerge(CrmEntryDeniedDependencies),
    Layer.provideMerge(HttpRouter.layer)
  )
)("public api CRM entry limit", (it) => {
  it.effect(
    "refuses a company create the workspace's plan has no room for",
    () =>
      Effect.gen(function* () {
        const workspace = yield* seedWorkspace();
        registerKey(
          "fbk_crm_denied",
          workspace.organizationId,
          COMPANY_MANAGEMENT_KEY_SCOPES
        );

        const created = yield* executeWrite("POST", "/api/v1/companies", {
          apiKey: "fbk_crm_denied",
          body: { name: "Acme" },
        });

        expect(created.status).toBe(403);
        expect(decodeError(responseBody(created))._tag).toBe(
          "PLAN_REQUIRES_UPGRADE"
        );

        // Nothing was written, and the refusal is about this write rather
        // than about the key: reading the workspace's companies still works.
        const db = yield* currentDb;
        const mine = yield* db
          .select()
          .from(schema.companyTable)
          .where(
            eq(schema.companyTable.organizationId, workspace.organizationId)
          );
        expect(mine).toHaveLength(0);

        const listed = yield* executeRequest(
          "/api/v1/companies",
          "fbk_crm_denied"
        );
        expect(listed.status).toBe(200);
        expect(decodeCompanyPage(responseBody(listed)).data).toHaveLength(0);
      })
  );
});

/**
 * The CRM entry limit with room for one entry.
 *
 * The suite above proves the gate refuses. This one proves it counts: the cap
 * is read from the workspace's own rows, inside the transaction that writes the
 * row it authorizes, so the first create fits and the second does not.
 */
layer(
  makePublicApiRoute(makeApiKeyAuthMiddlewareLive()).pipe(
    Layer.provideMerge(CrmEntryCapOneDependencies),
    Layer.provideMerge(HttpRouter.layer)
  )
)("public api CRM entry limit of one", (it) => {
  it.effect("allows the create that fits and refuses the one after it", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey(
        "fbk_crm_cap",
        workspace.organizationId,
        COMPANY_MANAGEMENT_KEY_SCOPES
      );

      const first = yield* executeWrite("POST", "/api/v1/companies", {
        apiKey: "fbk_crm_cap",
        body: { name: "Acme" },
      });
      expect(first.status).toBe(201);

      // The count the policy reads is the workspace's committed rows, so the
      // create above is what makes this one exceed the cap.
      const second = yield* executeWrite("POST", "/api/v1/companies", {
        apiKey: "fbk_crm_cap",
        body: { name: "Acme Ltd" },
      });
      expect(second.status).toBe(403);
      expect(decodeError(responseBody(second))._tag).toBe(
        "PLAN_REQUIRES_UPGRADE"
      );

      // The refusal rolled back: the workspace holds the one company the plan
      // allows and not the one it refused.
      const listed = yield* executeRequest("/api/v1/companies", "fbk_crm_cap");
      const page = decodeCompanyPage(responseBody(listed));
      expect(page.data.map((company) => company.name)).toEqual(["Acme"]);
    })
  );
});
