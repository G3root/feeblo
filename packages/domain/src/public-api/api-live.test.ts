import { NodeHttpPlatform, NodeServices } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Etag from "effect/unstable/http/Etag";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import type { ApiKeyAuthRecord } from "../api-key/schema";
import { Auth } from "../auth-handler";
import { EntitlementPolicy } from "../entitlement/policies";
import { RateLimitService } from "../rate-limit/service";
import { WorkspaceRepository } from "../workspace/repository";
import { PublicApiConfig } from "./config";
import {
  makeApiKeyAuthMiddlewareLive,
  PUBLIC_API_KEY_RATE_LIMIT,
} from "./middleware";
import { PublicApiRepository } from "./repository";
import { makePublicApiRoute } from "./router";
import { PublicApiPost, PublicApiPostPage } from "./schema";

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
const decodeDocument = Schema.decodeUnknownSync(
  Schema.fromJsonString(OpenApiDocument)
);

/** Handler dependencies, supplied from outside the route layer. */
const PublicApiDependencies = Layer.mergeAll(
  PublicApiRepository.layer,
  PublicApiConfig.layerTest(new URL("https://app.feeblo.test")),
  EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer)),
  WorkspaceRepository.layer,
  AuthTest,
  RateLimitService.layerMemory,
  Etag.layer,
  NodeHttpPlatform.layer,
  NodeServices.layer
  // Merged so test bodies can seed fixtures through `currentDb`.
).pipe(Layer.provideMerge(Database.PgliteDatabaseLive));

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

const executeRequest = (path: string, apiKey?: string) => {
  const request = HttpServerRequest.fromWeb(
    new Request(`http://localhost${path}`, {
      headers: apiKey === undefined ? {} : { "x-api-key": apiKey },
    })
  );
  return Effect.flatMap(HttpRouter.HttpRouter, (router) =>
    router.asHttpEffect()
  ).pipe(Effect.provideService(HttpServerRequest.HttpServerRequest, request));
};

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

const registerKey = (
  secret: string,
  organizationId: string,
  permissions: {
    readonly [resource: string]: readonly string[];
  } | null = { boards: ["read"], posts: ["read"] }
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

  it.effect("serves its own OpenAPI document without a key", () =>
    Effect.gen(function* () {
      const response = yield* executeRequest("/api/v1/openapi.json");

      // The document is the customer-facing reference and is public, so it must
      // not require a key.
      expect(response.status).toBe(200);
      const document = decodeDocument(responseBody(response));
      expect(Object.keys(document.paths).sort()).toEqual([
        "/api/v1/boards/{boardId}/posts",
        "/api/v1/posts/{postId}",
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
  }
);
