import {
  NodeCrypto,
  NodeHttpPlatform,
  NodeServices,
} from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { BoardId, PostId, PostStatusId, WorkspaceId } from "@feeblo/id";
import { slugify } from "@feeblo/utils/url";
import { and, eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { McpSchema } from "effect/unstable/ai";
import * as Etag from "effect/unstable/http/Etag";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import type { ApiKeyAuthRecord } from "../api-key/schema";
import { Auth } from "../auth-handler";
import { CompanyRepository } from "../company/repository";
import { EmailOutboxConfig } from "../email-outbox/config";
import { EmailOutboxRepository } from "../email-outbox/repository";
import { EmailSubscriptionRepository } from "../email-subscription/repository";
import { EmailSubscriptionTokenService } from "../email-subscription/tokens";
import { EntitlementPolicy } from "../entitlement/policies";
import { PolicyDeniedError } from "../policy";
import { RateLimitService } from "../rate-limit/service";
import { S3Test } from "../services/s3-test";
import { WorkspaceRepository } from "../workspace/repository";
import { PublicApiConfig } from "./config";
import { makePublicApiMcpRoute } from "./mcp";
import {
  makeApiKeyAuthMiddlewareLive,
  PUBLIC_API_KEY_RATE_LIMIT,
} from "./middleware";
import { PublicApiOperations } from "./operations";
import { makePublicApiRoute } from "./router";
import {
  PublicApiChangelog,
  PublicApiChangelogPage,
  PublicApiComment,
  PublicApiCommentPage,
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
const decodeChangelog = Schema.decodeUnknownSync(
  Schema.fromJsonString(PublicApiChangelog)
);
const decodeChangelogPage = Schema.decodeUnknownSync(
  Schema.fromJsonString(PublicApiChangelogPage)
);
const decodeCompany = Schema.decodeUnknownSync(
  Schema.fromJsonString(PublicApiCompany)
);
const decodeCompanyPage = Schema.decodeUnknownSync(
  Schema.fromJsonString(PublicApiCompanyPage)
);
const decodeComment = Schema.decodeUnknownSync(
  Schema.fromJsonString(PublicApiComment)
);
const decodeCommentPage = Schema.decodeUnknownSync(
  Schema.fromJsonString(PublicApiCommentPage)
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
 * decision the real one — the key still has to pass the real `canUsePublicApi`,
 * and a changelog publish still passes the real publish gate.
 */
const makePublicApiDependencies = (
  options: { readonly crmEntryLimit?: number } = {}
) => {
  // Destructured so the closure below captures a narrowed `const` rather than
  // re-reading an optional property.
  const { crmEntryLimit } = options;

  const entitlements =
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
        );

  return Layer.mergeAll(
    // The route owns the layers only it reads (`PublicApiInternals` in
    // `router.ts`). What is listed here is the shared layers it requires, with
    // the substitutes standing in for the production ones: the plan decision,
    // media storage, the session seam, the rate-limit budget, the runtime URLs
    // used to snapshot email links, and the application URL.
    PublicApiConfig.layerTest(new URL("https://app.feeblo.test")),
    // Post writes record integration events, and the recorder snapshots the
    // post's URL into the event. The test supplies its own URLs rather than
    // requiring `APP_URL`/`API_URL` in the environment.
    EmailOutboxConfig.layerTest(new URL("https://app.feeblo.test")),
    entitlements,
    // The surface requires the subscription repository — its post write path
    // subscribes a post's creator — and its token service reads
    // `AUTH_ENCRYPTION_KEY`. The test supplies a deterministic secret the way
    // the post handler suite does.
    EmailSubscriptionRepository.layerWithoutDependencies.pipe(
      Layer.provide(
        EmailSubscriptionTokenService.layerTest(
          "public-api-test-signing-secret"
        )
      )
    ),
    // Merged, not only provided: a test asserts the email intent a publish
    // records, and the layer is the only way a test body reaches the outbox.
    EmailOutboxRepository.layer,
    // The company repository is shared with the dashboard; the tests drive it
    // directly for the races the HTTP surface cannot produce.
    CompanyRepository.layer,
    WorkspaceRepository.layer,
    S3Test,
    AuthTest,
    RateLimitService.layerMemory,
    Etag.layer,
    NodeHttpPlatform.layer,
    // On-behalf resolution provisions a shadow user from the customer's email
    // and hashes it, so a comment create needs randomness the same way the
    // dashboard's on-behalf writes do.
    NodeCrypto.layer,
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
 * Inserts a changelog entry directly, so a test controls its status and age.
 *
 * Goes through the same `slugify` the repository uses, so a fixture cannot
 * disagree with the API about what an entry's slug is.
 */
const seedChangelog = (
  organizationId: string,
  options: {
    readonly content?: string;
    readonly createdAt?: Date;
    readonly id?: string;
    readonly slug?: string;
    readonly status?: "draft" | "scheduled" | "published";
    readonly title?: string;
  } = {}
) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const id = options.id ?? `chg_${Math.random().toString(36).slice(2, 10)}`;
    const title = options.title ?? "Release notes";
    const now = options.createdAt ?? new Date();
    yield* db.insert(schema.changelogTable).values({
      id,
      title,
      slug: options.slug ?? slugify(title),
      content: options.content ?? "Release body",
      excerpt: "Release excerpt",
      status: options.status ?? "draft",
      organizationId,
      createdAt: now,
      updatedAt: now,
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

/**
 * Inserts a comment directly, so a test controls its author, visibility, age,
 * parent, and pinned state.
 *
 * The author row is provisioned on first use because `comment.userId` is not
 * null; the same synthetic user is reused for every comment the helper seeds
 * in one workspace, so two comments can be pinned and unpinned against each
 * other without a second account.
 */
const seedComment = (
  organizationId: string,
  postId: string,
  id: string,
  options: {
    readonly authorName?: string;
    readonly createdAt?: Date;
    readonly parentCommentId?: string | null;
    readonly pinnedAt?: Date | null;
    readonly visibility?: "PUBLIC" | "INTERNAL";
  } = {}
) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const userId = `user_comment_${organizationId}`;
    const now = options.createdAt ?? new Date();

    yield* db
      .insert(schema.userTable)
      .values({
        id: userId,
        email: `${userId}@example.com`,
        name: options.authorName ?? "Commenter",
      })
      .onConflictDoNothing();

    yield* db.insert(schema.commentTable).values({
      id,
      content: "Seeded comment",
      organizationId,
      postId,
      userId,
      visibility: options.visibility ?? "PUBLIC",
      parentCommentId: options.parentCommentId ?? null,
      pinnedAt: options.pinnedAt ?? null,
      createdAt: now,
      updatedAt: now,
    });

    return { id, userId };
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
    // Minted through the legid factories rather than spelled out: the post
    // write path parses a board, status, workspace, and post id back into
    // branded ids when it records an integration event, so a fixture that
    // looked like one would fail there and nowhere else.
    const organizationId = yield* WorkspaceId.generate;
    const boardId = yield* BoardId.generate;
    const statusId = yield* PostStatusId.generate;
    const postId = yield* PostId.generate;
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
        id: yield* PostId.generate,
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
  comments: ["read"],
  tags: ["read"],
  changelog: ["read"],
};

const TAG_MANAGEMENT_KEY_SCOPES = {
  boards: ["read"],
  posts: ["read"],
  tags: ["read", "create", "update", "delete", "assign"],
};

/** The changelog reads plus every changelog write, publish included. */
const CHANGELOG_MANAGEMENT_KEY_SCOPES = {
  boards: ["read"],
  posts: ["read"],
  tags: ["read"],
  changelog: ["read", "create", "update", "delete", "publish"],
};

/** The changelog writes without the publish scope. */
const CHANGELOG_EDITOR_KEY_SCOPES = {
  boards: ["read"],
  posts: ["read"],
  tags: ["read"],
  changelog: ["read", "create", "update", "delete"],
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

/** The post reads plus every post write. */
const POST_MANAGEMENT_KEY_SCOPES = {
  boards: ["read"],
  posts: ["read", "create", "update", "delete"],
  tags: ["read"],
};

/** The post writes without the delete scope, to pin that it is required. */
const POST_EDITOR_KEY_SCOPES = {
  boards: ["read"],
  posts: ["read", "create", "update"],
  tags: ["read"],
};

/**
 * The comment grant: the reads every key now receives, plus every comment
 * write. Written out rather than imported so the test pins the vocabulary
 * instead of tracking it.
 */
const COMMENT_MANAGEMENT_KEY_SCOPES = {
  boards: ["read"],
  posts: ["read"],
  comments: ["read", "create", "update", "delete", "pin"],
  tags: ["read"],
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
    "lists the workspace's posts across every board, newest first",
    () =>
      Effect.gen(function* () {
        const workspace = yield* seedWorkspace({
          postCount: 2,
          includeArchivedPost: true,
        });
        registerKey("fbk_posts_list", workspace.organizationId);

        // A second board with a newer post, so the workspace list is provably
        // not just the first board's.
        const db = yield* currentDb;
        const now = new Date();
        const otherBoardId = yield* BoardId.generate;
        const otherPostId = yield* PostId.generate;
        yield* db.insert(schema.boardTable).values({
          id: otherBoardId,
          name: "Roadmap",
          slug: "roadmap",
          visibility: "PUBLIC",
          organizationId: workspace.organizationId,
          createdAt: now,
        });
        yield* db.insert(schema.postTable).values({
          id: otherPostId,
          title: "On another board",
          slug: "on-another-board",
          content: "<p>Body</p>",
          excerpt: "Body",
          boardId: otherBoardId,
          statusId: workspace.statusId,
          organizationId: workspace.organizationId,
          createdAt: new Date(now.getTime() + 60_000),
          updatedAt: now,
        });

        const response = yield* executeRequest(
          "/api/v1/posts",
          "fbk_posts_list"
        );
        expect(response.status).toBe(200);
        const page = decodePage(responseBody(response));
        expect(page.data.map((post) => post.id)).toEqual([
          otherPostId,
          workspace.postId,
          `${workspace.postId}_1`,
        ]);
        expect(page.data.map((post) => post.boardId)).toEqual([
          otherBoardId,
          workspace.boardId,
          workspace.boardId,
        ]);
        expect(page.nextCursor).toBeNull();

        // Same paging rule as the board list: one row per page and the cursor
        // walks to the next.
        const firstPage = yield* executeRequest(
          "/api/v1/posts?limit=1",
          "fbk_posts_list"
        );
        const firstBody = decodePage(responseBody(firstPage));
        expect(firstBody.data.map((post) => post.id)).toEqual([otherPostId]);
        expect(firstBody.nextCursor).toBeTypeOf("string");

        const secondPage = yield* executeRequest(
          `/api/v1/posts?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor ?? "")}`,
          "fbk_posts_list"
        );
        expect(
          decodePage(responseBody(secondPage)).data.map((post) => post.id)
        ).toEqual([workspace.postId]);

        // Archived posts are excluded by default and appear on request.
        const withArchived = yield* executeRequest(
          "/api/v1/posts?includeArchived=true",
          "fbk_posts_list"
        );
        expect(
          decodePage(responseBody(withArchived)).data.map((post) => post.title)
        ).toContain("Archived");
      })
  );

  it.effect("keeps the workspace list inside the calling workspace", () =>
    Effect.gen(function* () {
      const mine = yield* seedWorkspace();
      const theirs = yield* seedWorkspace();
      registerKey("fbk_list_mine", mine.organizationId);
      registerKey("fbk_list_theirs", theirs.organizationId);

      const response = yield* executeRequest("/api/v1/posts", "fbk_list_mine");
      const page = decodePage(responseBody(response));
      expect(page.data.map((post) => post.id)).toContain(mine.postId);
      expect(page.data.map((post) => post.id)).not.toContain(theirs.postId);
    })
  );

  it.effect("retrieves a post by id, or by board and slug", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey("fbk_retrieve", workspace.organizationId);

      const byId = yield* executeRequest(
        `/api/v1/posts/retrieve?id=${workspace.postId}`,
        "fbk_retrieve"
      );
      expect(byId.status).toBe(200);
      const fromId = decodePost(responseBody(byId));
      expect(fromId.id).toBe(workspace.postId);
      // The retrieve projection is the detail one: the body is included.
      expect(fromId.content).toBe("<p>Sanitized body</p>");

      const bySlug = yield* executeRequest(
        `/api/v1/posts/retrieve?boardId=${workspace.boardId}&slug=post-0`,
        "fbk_retrieve"
      );
      expect(bySlug.status).toBe(200);
      expect(decodePost(responseBody(bySlug)).id).toBe(workspace.postId);

      // Every identifier present must match, so all three agreeing is one
      // post and an id with the wrong board is not that post.
      const allThree = yield* executeRequest(
        `/api/v1/posts/retrieve?id=${workspace.postId}&boardId=${workspace.boardId}&slug=post-0`,
        "fbk_retrieve"
      );
      expect(allThree.status).toBe(200);

      const db = yield* currentDb;
      const otherBoardId = yield* BoardId.generate;
      yield* db.insert(schema.boardTable).values({
        id: otherBoardId,
        name: "Roadmap",
        slug: "roadmap",
        visibility: "PUBLIC",
        organizationId: workspace.organizationId,
        createdAt: new Date(),
      });

      const wrongBoard = yield* executeRequest(
        `/api/v1/posts/retrieve?id=${workspace.postId}&boardId=${otherBoardId}`,
        "fbk_retrieve"
      );
      expect(wrongBoard.status).toBe(404);
      expect(decodeError(responseBody(wrongBoard))._tag).toBe("NOT_FOUND");
    })
  );

  it.effect(
    "rejects a retrieve that names nothing, or a slug with no board",
    () =>
      Effect.gen(function* () {
        const workspace = yield* seedWorkspace();
        registerKey("fbk_retrieve", workspace.organizationId);

        const nothing = yield* executeRequest(
          "/api/v1/posts/retrieve",
          "fbk_retrieve"
        );
        expect(nothing.status).toBe(400);
        expect(decodeError(responseBody(nothing))._tag).toBe("INVALID_REQUEST");

        // A board alone does not name a post.
        const boardOnly = yield* executeRequest(
          `/api/v1/posts/retrieve?boardId=${workspace.boardId}`,
          "fbk_retrieve"
        );
        expect(boardOnly.status).toBe(400);

        // The pairing rule: a slug is only meaningful next to a board.
        const slugOnly = yield* executeRequest(
          "/api/v1/posts/retrieve?slug=post-0",
          "fbk_retrieve"
        );
        expect(slugOnly.status).toBe(400);
        expect(decodeError(responseBody(slugOnly)).message).toContain(
          "boardId"
        );

        // A blank parameter is not an identifier.
        const blank = yield* executeRequest(
          "/api/v1/posts/retrieve?id=",
          "fbk_retrieve"
        );
        expect(blank.status).toBe(400);
      })
  );

  it.effect("reports another workspace's post as not found on retrieve", () =>
    Effect.gen(function* () {
      const mine = yield* seedWorkspace();
      const theirs = yield* seedWorkspace();
      registerKey("fbk_retrieve_mine", mine.organizationId);

      const byId = yield* executeRequest(
        `/api/v1/posts/retrieve?id=${theirs.postId}`,
        "fbk_retrieve_mine"
      );
      expect(byId.status).toBe(404);
      expect(decodeError(responseBody(byId))._tag).toBe("NOT_FOUND");

      // Their board id does not make their slug retrievable either.
      const bySlug = yield* executeRequest(
        `/api/v1/posts/retrieve?boardId=${theirs.boardId}&slug=post-0`,
        "fbk_retrieve_mine"
      );
      expect(bySlug.status).toBe(404);
    })
  );

  it.effect("refuses the post reads without the posts.read scope", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey("fbk_boards_only", workspace.organizationId, {
        boards: ["read"],
      });

      const list = yield* executeRequest("/api/v1/posts", "fbk_boards_only");
      expect(list.status).toBe(403);
      expect(decodeError(responseBody(list))._tag).toBe("FORBIDDEN_SCOPE");

      const retrieve = yield* executeRequest(
        `/api/v1/posts/retrieve?id=${workspace.postId}`,
        "fbk_boards_only"
      );
      expect(retrieve.status).toBe(403);
      expect(decodeError(responseBody(retrieve)).message).toContain(
        "posts.read"
      );
    })
  );

  it.effect("creates a post, trimming its title and sanitizing its body", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey(
        "fbk_post_editor",
        workspace.organizationId,
        POST_EDITOR_KEY_SCOPES
      );

      const created = yield* executeWrite("POST", "/api/v1/posts", {
        apiKey: "fbk_post_editor",
        body: {
          boardId: workspace.boardId,
          title: "  Dark mode  ",
          content: "Dark mode please\n\n<script>alert(1)</script>",
          statusId: workspace.statusId,
        },
      });

      expect(created.status).toBe(201);
      const post = decodePost(responseBody(created));
      // The id is minted server-side; a caller does not choose identifiers.
      expect(post.id).toMatch(/^pst_/);
      expect(post.title).toBe("Dark mode");
      expect(post.slug).toBe("dark-mode");
      expect(post.boardId).toBe(workspace.boardId);
      expect(post.status.id).toBe(workspace.statusId);
      expect(post.content).not.toContain("<script>");
      expect(post.excerpt.length).toBeGreaterThan(0);
      expect(post.voteCount).toBe(0);
      expect(post.commentCount).toBe(0);
      expect(post.tags).toEqual([]);
      // A machine key is not a member: there is no author to name.
      expect(post.author).toEqual({
        type: "end_user",
        displayName: null,
        avatarUrl: null,
      });

      const db = yield* currentDb;
      const [row] = yield* db
        .select({
          creatorId: schema.postTable.creatorId,
          creatorMemberId: schema.postTable.creatorMemberId,
          source: schema.postTable.source,
        })
        .from(schema.postTable)
        .where(eq(schema.postTable.id, post.id));
      expect(row?.source).toBe("API");
      expect(row?.creatorId).toBeNull();
      expect(row?.creatorMemberId).toBeNull();

      // The shared write path ran its dashboard work: the timeline records the
      // creation, with no actor, because a key is not a member.
      const activities = yield* db
        .select({
          actorId: schema.postActivityTable.actorId,
          kind: schema.postActivityTable.kind,
        })
        .from(schema.postActivityTable)
        .where(eq(schema.postActivityTable.postId, post.id));
      expect(activities.map((activity) => activity.kind)).toEqual([
        "POST_CREATED",
      ]);
      expect(activities.at(0)?.actorId).toBeNull();
    })
  );

  it.effect("refuses a post write without the write scope", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey("fbk_posts_read_only", workspace.organizationId);

      const response = yield* executeWrite("POST", "/api/v1/posts", {
        apiKey: "fbk_posts_read_only",
        body: {
          boardId: workspace.boardId,
          title: "Nope",
          content: "Nope",
          statusId: workspace.statusId,
        },
      });

      expect(response.status).toBe(403);
      const body = decodeError(responseBody(response));
      expect(body._tag).toBe("FORBIDDEN_SCOPE");
      expect(body.message).toContain("posts.create");
    })
  );

  it.effect("rejects a board or status the workspace does not have", () =>
    Effect.gen(function* () {
      const mine = yield* seedWorkspace();
      const theirs = yield* seedWorkspace();
      registerKey(
        "fbk_post_editor",
        mine.organizationId,
        POST_EDITOR_KEY_SCOPES
      );

      const foreignBoard = yield* executeWrite("POST", "/api/v1/posts", {
        apiKey: "fbk_post_editor",
        body: {
          boardId: theirs.boardId,
          title: "Foreign board",
          content: "Body",
          statusId: mine.statusId,
        },
      });
      // A board from another workspace is a request the caller can fix, not a
      // 404 (the endpoint makes the resource) and not a server error.
      expect(foreignBoard.status).toBe(400);
      expect(decodeError(responseBody(foreignBoard))._tag).toBe(
        "INVALID_REQUEST"
      );

      const unknownStatus = yield* executeWrite("POST", "/api/v1/posts", {
        apiKey: "fbk_post_editor",
        body: {
          boardId: mine.boardId,
          title: "Unknown status",
          content: "Body",
          statusId: "pss_not_a_status",
        },
      });
      expect(unknownStatus.status).toBe(400);
      expect(decodeError(responseBody(unknownStatus))._tag).toBe(
        "INVALID_REQUEST"
      );
    })
  );

  it.effect("measures a title's length after trimming it", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey(
        "fbk_post_editor",
        workspace.organizationId,
        POST_EDITOR_KEY_SCOPES
      );

      // The maximum, padded: the old raw-length check would have rejected
      // this, while the dashboard accepts it and stores it trimmed.
      const title = "a".repeat(200);
      const padded = yield* executeWrite("POST", "/api/v1/posts", {
        apiKey: "fbk_post_editor",
        body: {
          boardId: workspace.boardId,
          title: `  ${title}  `,
          content: "Body",
          statusId: workspace.statusId,
        },
      });

      expect(padded.status).toBe(201);
      expect(decodePost(responseBody(padded)).title).toBe(title);

      // Padding does not excuse a title that is too long once trimmed.
      const tooLong = yield* executeWrite("POST", "/api/v1/posts", {
        apiKey: "fbk_post_editor",
        body: {
          boardId: workspace.boardId,
          title: `  ${"a".repeat(201)}  `,
          content: "Body",
          statusId: workspace.statusId,
        },
      });
      expect(tooLong.status).toBe(400);
      expect(decodeError(responseBody(tooLong))._tag).toBe("INVALID_REQUEST");
    })
  );

  it.effect("rejects a title that is only whitespace", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey(
        "fbk_post_editor",
        workspace.organizationId,
        POST_EDITOR_KEY_SCOPES
      );

      const response = yield* executeWrite("POST", "/api/v1/posts", {
        apiKey: "fbk_post_editor",
        body: {
          boardId: workspace.boardId,
          title: "   ",
          content: "Body",
          statusId: workspace.statusId,
        },
      });

      expect(response.status).toBe(400);
      const body = decodeError(responseBody(response));
      expect(body._tag).toBe("INVALID_REQUEST");
      expect(body.message).toContain("title");
    })
  );

  it.effect(
    "deduplicates a title's slug instead of refusing the second post",
    () =>
      Effect.gen(function* () {
        const workspace = yield* seedWorkspace();
        registerKey(
          "fbk_post_editor",
          workspace.organizationId,
          POST_EDITOR_KEY_SCOPES
        );

        const body = {
          boardId: workspace.boardId,
          title: "Dark mode",
          content: "Body",
          statusId: workspace.statusId,
        };
        const first = yield* executeWrite("POST", "/api/v1/posts", {
          apiKey: "fbk_post_editor",
          body,
        });
        const second = yield* executeWrite("POST", "/api/v1/posts", {
          apiKey: "fbk_post_editor",
          body,
        });

        // Slugs are unique per workspace and two posts really may share a title,
        // so the create suffixes rather than colliding.
        expect(first.status).toBe(201);
        expect(second.status).toBe(201);
        expect(decodePost(responseBody(first)).slug).toBe("dark-mode");
        expect(decodePost(responseBody(second)).slug).toBe("dark-mode-2");
      })
  );

  it.effect("reports a title whose slug space is exhausted as a conflict", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey(
        "fbk_post_editor",
        workspace.organizationId,
        POST_EDITOR_KEY_SCOPES
      );

      const body = {
        boardId: workspace.boardId,
        title: "Duplicate",
        content: "Body",
        statusId: workspace.statusId,
      };

      // The create suffixes a taken slug, so the tenth identical title still
      // succeeds; the attempt after that has no suffix left and is the only
      // way this endpoint answers a conflict.
      for (let index = 0; index < 10; index += 1) {
        const created = yield* executeWrite("POST", "/api/v1/posts", {
          apiKey: "fbk_post_editor",
          body,
        });
        expect(created.status).toBe(201);
      }

      const exhausted = yield* executeWrite("POST", "/api/v1/posts", {
        apiKey: "fbk_post_editor",
        body,
      });
      expect(exhausted.status).toBe(409);
      expect(decodeError(responseBody(exhausted))._tag).toBe("CONFLICT");
    })
  );

  it.effect(
    "updates a post's fields and answers with the post afterwards",
    () =>
      Effect.gen(function* () {
        const workspace = yield* seedWorkspace();
        registerKey(
          "fbk_post_editor",
          workspace.organizationId,
          POST_MANAGEMENT_KEY_SCOPES
        );

        // A second board and status, so the update has somewhere to move the
        // post and something to change its status to.
        const db = yield* currentDb;
        const now = new Date();
        const otherBoardId = yield* BoardId.generate;
        const otherStatusId = yield* PostStatusId.generate;
        yield* db.insert(schema.boardTable).values({
          id: otherBoardId,
          name: "Roadmap",
          slug: "roadmap",
          visibility: "PUBLIC",
          organizationId: workspace.organizationId,
          createdAt: now,
        });
        yield* db.insert(schema.postStatusTable).values({
          id: otherStatusId,
          type: "IN_PROGRESS",
          label: "In progress",
          orderIndex: 1,
          organizationId: workspace.organizationId,
          createdAt: now,
        });

        const response = yield* executeWrite(
          "PATCH",
          `/api/v1/posts/${workspace.postId}`,
          {
            apiKey: "fbk_post_editor",
            body: {
              title: "Dark mode, shipped",
              content: "It is live",
              statusId: otherStatusId,
              boardId: otherBoardId,
              etaQuarter: "2026-Q4",
            },
          }
        );

        expect(response.status).toBe(200);
        const post = decodePost(responseBody(response));
        expect(post.id).toBe(workspace.postId);
        expect(post.title).toBe("Dark mode, shipped");
        expect(post.content).toContain("It is live");
        expect(post.status.id).toBe(otherStatusId);
        expect(post.boardId).toBe(otherBoardId);
        expect(post.etaQuarter).toBe("2026-Q4");

        // Every change is on the post's timeline, and the actor columns stay
        // empty: the key is not a member and must not borrow one.
        const activities = yield* db
          .select({
            actorId: schema.postActivityTable.actorId,
            kind: schema.postActivityTable.kind,
          })
          .from(schema.postActivityTable)
          .where(eq(schema.postActivityTable.postId, workspace.postId));
        expect(activities.map((activity) => activity.kind).sort()).toEqual([
          "BOARD_CHANGED",
          "CONTENT_CHANGED",
          "ETA_CHANGED",
          "STATUS_CHANGED",
          "TITLE_CHANGED",
        ]);
        expect(activities.every((activity) => activity.actorId === null)).toBe(
          true
        );
      })
  );

  it.effect("clears a nullable field with an explicit null", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey(
        "fbk_post_editor",
        workspace.organizationId,
        POST_MANAGEMENT_KEY_SCOPES
      );

      const db = yield* currentDb;
      yield* db
        .update(schema.postTable)
        .set({ etaQuarter: "2026-Q1" })
        .where(eq(schema.postTable.id, workspace.postId));

      const response = yield* executeWrite(
        "PATCH",
        `/api/v1/posts/${workspace.postId}`,
        { apiKey: "fbk_post_editor", body: { etaQuarter: null } }
      );

      expect(response.status).toBe(200);
      expect(decodePost(responseBody(response)).etaQuarter).toBeNull();
    })
  );

  it.effect("rejects an update that names no field", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey(
        "fbk_post_editor",
        workspace.organizationId,
        POST_MANAGEMENT_KEY_SCOPES
      );

      const response = yield* executeWrite(
        "PATCH",
        `/api/v1/posts/${workspace.postId}`,
        { apiKey: "fbk_post_editor", body: {} }
      );

      // A write that changed nothing is answered as the mistake it is, not as
      // a successful no-op.
      expect(response.status).toBe(400);
      expect(decodeError(responseBody(response))._tag).toBe("INVALID_REQUEST");
    })
  );

  it.effect("refuses an update without the posts.update scope", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey("fbk_posts_read_only", workspace.organizationId);

      const response = yield* executeWrite(
        "PATCH",
        `/api/v1/posts/${workspace.postId}`,
        { apiKey: "fbk_posts_read_only", body: { title: "Nope" } }
      );

      expect(response.status).toBe(403);
      const body = decodeError(responseBody(response));
      expect(body._tag).toBe("FORBIDDEN_SCOPE");
      expect(body.message).toContain("posts.update");
    })
  );

  it.effect("reports another workspace's post as not found on a write", () =>
    Effect.gen(function* () {
      const mine = yield* seedWorkspace();
      const theirs = yield* seedWorkspace();
      registerKey(
        "fbk_post_admin",
        mine.organizationId,
        POST_MANAGEMENT_KEY_SCOPES
      );

      const update = yield* executeWrite(
        "PATCH",
        `/api/v1/posts/${theirs.postId}`,
        { apiKey: "fbk_post_admin", body: { title: "Renamed" } }
      );
      expect(update.status).toBe(404);

      const remove = yield* executeWrite(
        "DELETE",
        `/api/v1/posts/${theirs.postId}`,
        { apiKey: "fbk_post_admin" }
      );
      expect(remove.status).toBe(404);
      expect(decodeError(responseBody(remove))._tag).toBe("NOT_FOUND");
    })
  );

  it.effect("deletes a post and reports it gone afterwards", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey(
        "fbk_post_admin",
        workspace.organizationId,
        POST_MANAGEMENT_KEY_SCOPES
      );

      const removed = yield* executeWrite(
        "DELETE",
        `/api/v1/posts/${workspace.postId}`,
        { apiKey: "fbk_post_admin" }
      );
      expect(removed.status).toBe(204);
      expect(responseBody(removed)).toBe("");

      const read = yield* executeRequest(
        `/api/v1/posts/${workspace.postId}`,
        "fbk_post_admin"
      );
      expect(read.status).toBe(404);
    })
  );

  it.effect("refuses a delete without the posts.delete scope", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey(
        "fbk_post_editor",
        workspace.organizationId,
        POST_EDITOR_KEY_SCOPES
      );

      const response = yield* executeWrite(
        "DELETE",
        `/api/v1/posts/${workspace.postId}`,
        { apiKey: "fbk_post_editor" }
      );

      expect(response.status).toBe(403);
      const body = decodeError(responseBody(response));
      expect(body._tag).toBe("FORBIDDEN_SCOPE");
      expect(body.message).toContain("posts.delete");
    })
  );

  it.effect("refuses to delete a post that was merged into another", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey(
        "fbk_post_admin",
        workspace.organizationId,
        POST_MANAGEMENT_KEY_SCOPES
      );

      const db = yield* currentDb;
      const now = new Date();
      const mergedId = yield* PostId.generate;
      yield* db.insert(schema.postTable).values({
        id: mergedId,
        title: "Duplicate",
        slug: "duplicate",
        content: "<p>Body</p>",
        excerpt: "Body",
        boardId: workspace.boardId,
        statusId: workspace.statusId,
        organizationId: workspace.organizationId,
        mergedIntoPostId: workspace.postId,
        mergedAt: now,
        // A merged row must also be archived (the table's own check
        // constraint), which is the state the merge path leaves behind.
        archivedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      const response = yield* executeWrite(
        "DELETE",
        `/api/v1/posts/${mergedId}`,
        { apiKey: "fbk_post_admin" }
      );

      // The post is readable through `GET`, so `404` would be a lie; the
      // request cannot be applied to its state.
      expect(response.status).toBe(400);
      expect(decodeError(responseBody(response))._tag).toBe("INVALID_REQUEST");
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

  it.effect("lists changelog entries newest first and filters by status", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey("fbk_changelog_read", workspace.organizationId);
      const now = new Date();
      yield* seedChangelog(workspace.organizationId, {
        createdAt: new Date(now.getTime() - 60_000),
        id: "chg_old",
        status: "draft",
        title: "Older draft",
      });
      yield* seedChangelog(workspace.organizationId, {
        createdAt: now,
        id: "chg_new",
        status: "published",
        title: "Newer release",
      });

      const page = decodeChangelogPage(
        responseBody(
          yield* executeRequest("/api/v1/changelog", "fbk_changelog_read")
        )
      );
      // Drafts are listed: the key belongs to the workspace, so it sees what
      // has not shipped yet.
      expect(page.data.map((entry) => entry.id)).toEqual([
        "chg_new",
        "chg_old",
      ]);
      expect(page.nextCursor).toBeNull();

      const drafts = decodeChangelogPage(
        responseBody(
          yield* executeRequest(
            "/api/v1/changelog?status=draft",
            "fbk_changelog_read"
          )
        )
      );
      expect(drafts.data.map((entry) => entry.id)).toEqual(["chg_old"]);

      const malformed = yield* executeRequest(
        "/api/v1/changelog?status=nope",
        "fbk_changelog_read"
      );
      expect(malformed.status).toBe(400);
      expect(decodeError(responseBody(malformed))._tag).toBe("INVALID_REQUEST");
    })
  );

  it.effect("refuses the changelog without the changelog.read scope", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey("fbk_posts_only", workspace.organizationId, {
        posts: ["read"],
      });

      const response = yield* executeRequest(
        "/api/v1/changelog",
        "fbk_posts_only"
      );

      expect(response.status).toBe(403);
      const body = decodeError(responseBody(response));
      expect(body._tag).toBe("FORBIDDEN_SCOPE");
      expect(body.message).toContain("changelog.read");
    })
  );

  it.effect(
    "returns an entry's body on the detail endpoint only, and hides another workspace's entry",
    () =>
      Effect.gen(function* () {
        const workspace = yield* seedWorkspace();
        const other = yield* seedWorkspace();
        const id = yield* seedChangelog(workspace.organizationId, {
          content: "Dark mode is live. Enable it in **Settings**.",
        });
        registerKey("fbk_changelog_detail", workspace.organizationId);
        registerKey("fbk_changelog_foreign", other.organizationId);

        const listed = decodeChangelogPage(
          responseBody(
            yield* executeRequest("/api/v1/changelog", "fbk_changelog_detail")
          )
        );
        expect(listed.data[0]).not.toHaveProperty("content");

        const detail = decodeChangelog(
          responseBody(
            yield* executeRequest(
              `/api/v1/changelog/${id}`,
              "fbk_changelog_detail"
            )
          )
        );
        expect(detail.content).toBe(
          "Dark mode is live. Enable it in **Settings**."
        );

        // A key for another workspace is told the entry does not exist, so the
        // id cannot be used to probe for it.
        const foreign = yield* executeRequest(
          `/api/v1/changelog/${id}`,
          "fbk_changelog_foreign"
        );
        expect(foreign.status).toBe(404);
        expect(decodeError(responseBody(foreign))._tag).toBe("NOT_FOUND");
      })
  );

  it.effect("creates a draft, trimming its title and sanitizing its body", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey(
        "fbk_changelog_editor",
        workspace.organizationId,
        CHANGELOG_EDITOR_KEY_SCOPES
      );

      const created = yield* executeWrite("POST", "/api/v1/changelog", {
        apiKey: "fbk_changelog_editor",
        body: {
          title: "  Dark mode  ",
          content: "Dark mode is live\n\n<script>alert(1)</script>",
        },
      });

      expect(created.status).toBe(201);
      const entry = decodeChangelog(responseBody(created));
      // The id is minted server-side; a caller does not choose identifiers.
      expect(entry.id).toMatch(/^chg_/);
      expect(entry.title).toBe("Dark mode");
      expect(entry.slug).toBe("dark-mode");
      expect(entry.status).toBe("draft");
      expect(entry.content).not.toContain("<script>");
      expect(entry.excerpt.length).toBeGreaterThan(0);
    })
  );

  it.effect("rejects a published entry with no published date", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey(
        "fbk_changelog_publisher",
        workspace.organizationId,
        CHANGELOG_MANAGEMENT_KEY_SCOPES
      );

      const response = yield* executeWrite("POST", "/api/v1/changelog", {
        apiKey: "fbk_changelog_publisher",
        body: { title: "Release", content: "Body", status: "published" },
      });

      // The server must not invent a date that decides a reader's ordering.
      expect(response.status).toBe(400);
      expect(decodeError(responseBody(response))._tag).toBe("INVALID_REQUEST");
    })
  );

  it.effect("reports a duplicate slug as a conflict", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey(
        "fbk_changelog_conflict",
        workspace.organizationId,
        CHANGELOG_EDITOR_KEY_SCOPES
      );

      const first = yield* executeWrite("POST", "/api/v1/changelog", {
        apiKey: "fbk_changelog_conflict",
        body: { title: "UI Kit", content: "Body" },
      });
      expect(first.status).toBe(201);

      // A different title that slugifies to the same slug is the same
      // collision, so the second create must not make a near-duplicate.
      const sameSlug = yield* executeWrite("POST", "/api/v1/changelog", {
        apiKey: "fbk_changelog_conflict",
        body: { title: "ui-kit", content: "Body" },
      });
      expect(sameSlug.status).toBe(409);
      expect(decodeError(responseBody(sameSlug))._tag).toBe("CONFLICT");
    })
  );

  it.effect("refuses to publish without the changelog.publish scope", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey(
        "fbk_changelog_editor",
        workspace.organizationId,
        CHANGELOG_EDITOR_KEY_SCOPES
      );

      const response = yield* executeWrite("POST", "/api/v1/changelog", {
        apiKey: "fbk_changelog_editor",
        body: {
          title: "Release",
          content: "Body",
          publishedAt: "2026-09-01T00:00:00.000Z",
          status: "published",
        },
      });

      expect(response.status).toBe(403);
      const body = decodeError(responseBody(response));
      expect(body._tag).toBe("FORBIDDEN_SCOPE");
      expect(body.message).toContain("changelog.publish");

      // Nothing was written: a refused publish is not a draft.
      const listed = decodeChangelogPage(
        responseBody(
          yield* executeRequest("/api/v1/changelog", "fbk_changelog_editor")
        )
      );
      expect(listed.data).toHaveLength(0);
    })
  );

  it.effect(
    "publishes with the scope and records exactly one email intent",
    () =>
      Effect.gen(function* () {
        const workspace = yield* seedWorkspace();
        registerKey(
          "fbk_changelog_publisher",
          workspace.organizationId,
          CHANGELOG_MANAGEMENT_KEY_SCOPES
        );
        const outbox = yield* EmailOutboxRepository;

        const created = yield* executeWrite("POST", "/api/v1/changelog", {
          apiKey: "fbk_changelog_publisher",
          body: {
            title: "Release",
            content: "Body",
            publishedAt: "2026-09-01T00:00:00.000Z",
            status: "published",
          },
        });

        expect(created.status).toBe(201);
        const entry = decodeChangelog(responseBody(created));
        expect(entry.status).toBe("published");
        expect(entry.publishedAt).toEqual(new Date("2026-09-01T00:00:00.000Z"));

        const intents = yield* outbox.findPending({
          before: new Date(Date.now() + 60_000),
          organizationId: workspace.organizationId,
        });
        expect(intents.map((intent) => intent.kind)).toEqual([
          "changelog.published",
        ]);
      })
  );

  it.effect(
    "publishes a draft with the scope and does not notify twice when it is edited",
    () =>
      Effect.gen(function* () {
        const workspace = yield* seedWorkspace();
        const id = yield* seedChangelog(workspace.organizationId, {
          status: "draft",
        });
        registerKey(
          "fbk_changelog_editor",
          workspace.organizationId,
          CHANGELOG_EDITOR_KEY_SCOPES
        );
        registerKey(
          "fbk_changelog_publisher",
          workspace.organizationId,
          CHANGELOG_MANAGEMENT_KEY_SCOPES
        );
        const outbox = yield* EmailOutboxRepository;
        const publishedAt = "2026-09-01T00:00:00.000Z";

        const denied = yield* executeWrite("PATCH", `/api/v1/changelog/${id}`, {
          apiKey: "fbk_changelog_editor",
          body: {
            title: "Release",
            content: "Body",
            publishedAt,
            status: "published",
          },
        });
        expect(denied.status).toBe(403);
        expect(decodeError(responseBody(denied))._tag).toBe("FORBIDDEN_SCOPE");

        const published = yield* executeWrite(
          "PATCH",
          `/api/v1/changelog/${id}`,
          {
            apiKey: "fbk_changelog_publisher",
            body: {
              title: "Release",
              content: "Body",
              publishedAt,
              status: "published",
            },
          }
        );
        expect(published.status).toBe(200);
        expect(decodeChangelog(responseBody(published)).status).toBe(
          "published"
        );

        // Editing an entry that is already published is an ordinary update:
        // no transition, so no second email and no publish scope required.
        const edited = yield* executeWrite("PATCH", `/api/v1/changelog/${id}`, {
          apiKey: "fbk_changelog_editor",
          body: {
            title: "Release (edited)",
            content: "Edited body",
            publishedAt,
            status: "published",
          },
        });
        expect(edited.status).toBe(200);
        expect(decodeChangelog(responseBody(edited)).title).toBe(
          "Release (edited)"
        );

        const intents = yield* outbox.findPending({
          before: new Date(Date.now() + 60_000),
          organizationId: workspace.organizationId,
        });
        expect(intents.map((intent) => intent.kind)).toEqual([
          "changelog.published",
        ]);
      })
  );

  it.effect("deletes an entry and reports it gone afterwards", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      const id = yield* seedChangelog(workspace.organizationId);
      registerKey(
        "fbk_changelog_deleter",
        workspace.organizationId,
        CHANGELOG_EDITOR_KEY_SCOPES
      );

      const deleted = yield* executeWrite("DELETE", `/api/v1/changelog/${id}`, {
        apiKey: "fbk_changelog_deleter",
      });
      expect(deleted.status).toBe(204);

      // Deleting an entry that is already gone is a 404 rather than a
      // success: the caller cannot tell a delete that worked from one that
      // named the wrong workspace, and the second is worth knowing.
      const again = yield* executeWrite("DELETE", `/api/v1/changelog/${id}`, {
        apiKey: "fbk_changelog_deleter",
      });
      expect(again.status).toBe(404);
      expect(decodeError(responseBody(again))._tag).toBe("NOT_FOUND");
    })
  );

  it.effect("reports another workspace's entry as not found on a write", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      const other = yield* seedWorkspace();
      const id = yield* seedChangelog(other.organizationId, {
        status: "draft",
      });
      registerKey(
        "fbk_changelog_writer",
        workspace.organizationId,
        CHANGELOG_MANAGEMENT_KEY_SCOPES
      );

      const updated = yield* executeWrite("PATCH", `/api/v1/changelog/${id}`, {
        apiKey: "fbk_changelog_writer",
        body: { title: "Hijacked", content: "Body", status: "draft" },
      });
      expect(updated.status).toBe(404);
      expect(decodeError(responseBody(updated))._tag).toBe("NOT_FOUND");

      const deleted = yield* executeWrite("DELETE", `/api/v1/changelog/${id}`, {
        apiKey: "fbk_changelog_writer",
      });
      expect(deleted.status).toBe(404);

      // The other workspace's list is untouched.
      const list = decodeChangelogPage(
        responseBody(
          yield* executeRequest("/api/v1/changelog", "fbk_changelog_writer")
        )
      );
      expect(list.data).toHaveLength(0);
    })
  );

  it.effect("sweeps the editor assets a deleted entry orphaned", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      const id = yield* seedChangelog(workspace.organizationId);
      const db = yield* currentDb;

      // An editor asset only this entry referenced, old enough to be past the
      // cleanup's grace period. Its `changelog_asset` reference cascades with
      // the entry, which is what makes it an orphan after the delete. Dated
      // from the Effect clock, which the cleanup reads through `DateTime.now`;
      // the wall clock would put it in the future of the test's clock.
      const now = yield* DateTime.nowAsDate;
      yield* db.insert(schema.assetTable).values({
        id: "ast_changelog_orphan",
        bucket: "media",
        key: "editor-media/changelog-orphan.png",
        url: "https://media.test/editor-media/changelog-orphan.png",
        kind: "editor_image",
        organizationId: workspace.organizationId,
        createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      });
      yield* db.insert(schema.changelogAssetTable).values({
        changelogId: id,
        assetId: "ast_changelog_orphan",
      });
      registerKey(
        "fbk_changelog_sweeper",
        workspace.organizationId,
        CHANGELOG_EDITOR_KEY_SCOPES
      );

      const deleted = yield* executeWrite("DELETE", `/api/v1/changelog/${id}`, {
        apiKey: "fbk_changelog_sweeper",
      });
      expect(deleted.status).toBe(204);

      const remaining = yield* db
        .select({ id: schema.assetTable.id })
        .from(schema.assetTable)
        .where(eq(schema.assetTable.id, "ast_changelog_orphan"));
      expect(remaining).toHaveLength(0);
    })
  );

  it.effect("never emits a changelog entry's internal identifiers", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      yield* seedChangelog(workspace.organizationId, {
        status: "published",
      });
      registerKey("fbk_changelog_private", workspace.organizationId);

      const response = yield* executeRequest(
        "/api/v1/changelog",
        "fbk_changelog_private"
      );
      const raw = responseBody(response);

      expect(decodeChangelogPage(raw).data).toHaveLength(1);
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
        const repository = yield* CompanyRepository;

        // The window the handler cannot close: it reads the company, another
        // request deletes it, and the update then matches no row. That is the
        // documented "not found" and not a driver failure, so the repository
        // reports it as the absence it is rather than as an internal error.
        const updated = yield* repository.update({
          avatar: null,
          id: "cmp_vanished",
          externalCreatedAt: null,
          externalId: null,
          name: "Renamed",
          organizationId: workspace.organizationId,
        });

        expect(Option.isNone(updated)).toBe(true);
      })
  );

  it.effect("reports a delete that matched no row, and the one that did", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      const repository = yield* CompanyRepository;

      // The window the handler cannot close: it reads the company, another
      // request deletes it, and this delete then matches no row. That is the
      // documented "not found" and not a success, so the repository reports
      // it instead of a 204 that hides which workspace it deleted from.
      const raced = yield* repository.delete({
        id: "cmp_vanished",
        organizationId: workspace.organizationId,
      });
      expect(Option.isNone(raced)).toBe(true);

      yield* seedCompany(workspace.organizationId, "cmp_present", "Present");
      const deleted = yield* repository.delete({
        id: "cmp_present",
        organizationId: workspace.organizationId,
      });
      expect(Option.isSome(deleted)).toBe(true);
      expect(
        Option.isNone(
          yield* repository.findById({
            id: "cmp_present",
            organizationId: workspace.organizationId,
          })
        )
      ).toBe(true);
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

  it.effect(
    "lists a post's comments newest first, internal included, without identifiers",
    () =>
      Effect.gen(function* () {
        const workspace = yield* seedWorkspace();
        const older = new Date(Date.now() - 60_000);
        yield* seedComment(
          workspace.organizationId,
          workspace.postId,
          "cmt_older",
          {
            authorName: "Ada",
            createdAt: older,
            visibility: "INTERNAL",
          }
        );
        yield* seedComment(
          workspace.organizationId,
          workspace.postId,
          "cmt_newer",
          {
            authorName: "Grace",
            createdAt: new Date(),
          }
        );
        registerKey("fbk_comments_read", workspace.organizationId);

        const response = yield* executeRequest(
          `/api/v1/posts/${workspace.postId}/comments`,
          "fbk_comments_read"
        );

        expect(response.status).toBe(200);
        const body = responseBody(response);
        const page = decodeCommentPage(body);

        expect(page.data.map((comment) => comment.id)).toEqual([
          "cmt_newer",
          "cmt_older",
        ]);
        // A key reads its own workspace, internal notes included.
        expect(page.data[1]).toMatchObject({
          visibility: "INTERNAL",
          author: { type: "end_user", displayName: "Ada" },
        });
        expect(page.data[0]?.postId).toBe(workspace.postId);
        expect(page.nextCursor).toBeNull();

        // `comment` also carries `userId` and `memberId`; neither has a name in
        // the published payload, and neither may appear on the wire.
        for (const forbidden of [
          "userId",
          "memberId",
          "organizationId",
          "mergedFromPostId",
          "statusUpdateId",
        ]) {
          expect(body).not.toContain(forbidden);
        }

        // A post that does not exist is a 404 rather than an empty page, and
        // another workspace's post is reported the same way.
        const missing = yield* executeRequest(
          "/api/v1/posts/pst_missing/comments",
          "fbk_comments_read"
        );
        expect(missing.status).toBe(404);
        expect(decodeError(responseBody(missing))._tag).toBe("NOT_FOUND");
      })
  );

  it.effect("reports a comment of another workspace as not found", () =>
    Effect.gen(function* () {
      const mine = yield* seedWorkspace();
      const theirs = yield* seedWorkspace();
      yield* seedComment(theirs.organizationId, theirs.postId, "cmt_theirs");
      registerKey(
        "fbk_comments_scoped",
        mine.organizationId,
        COMMENT_MANAGEMENT_KEY_SCOPES
      );

      const read = yield* executeRequest(
        "/api/v1/comments/cmt_theirs",
        "fbk_comments_scoped"
      );
      expect(read.status).toBe(404);
      expect(decodeError(responseBody(read))._tag).toBe("NOT_FOUND");

      const update = yield* executeWrite(
        "PATCH",
        "/api/v1/comments/cmt_theirs",
        { apiKey: "fbk_comments_scoped", body: { content: "Hijacked" } }
      );
      expect(update.status).toBe(404);

      const remove = yield* executeWrite(
        "DELETE",
        "/api/v1/comments/cmt_theirs",
        { apiKey: "fbk_comments_scoped" }
      );
      expect(remove.status).toBe(404);
    })
  );

  it.effect(
    "creates a comment on behalf of a customer and records it in the timeline",
    () =>
      Effect.gen(function* () {
        const workspace = yield* seedWorkspace();
        const db = yield* currentDb;
        registerKey(
          "fbk_comments_write",
          workspace.organizationId,
          COMMENT_MANAGEMENT_KEY_SCOPES
        );

        const response = yield* executeWrite(
          "POST",
          `/api/v1/posts/${workspace.postId}/comments`,
          {
            apiKey: "fbk_comments_write",
            body: {
              content: "Hello from the integration",
              author: { email: "jane@example.com", name: "Jane Doe" },
            },
          }
        );

        expect(response.status).toBe(201);
        const created = decodeComment(responseBody(response));
        expect(created.id).toMatch(/^cmt_/);
        expect(created).toMatchObject({
          postId: workspace.postId,
          visibility: "PUBLIC",
          parentCommentId: null,
          pinnedAt: null,
          author: { type: "end_user", displayName: "Jane Doe" },
        });
        expect(created.content).toContain("Hello from the integration");

        // The comment is attributed to a shadow account for the resolved
        // customer, never to the key: an API key is not a member.
        const [comment] = yield* db
          .select()
          .from(schema.commentTable)
          .where(eq(schema.commentTable.id, created.id))
          .limit(1);
        expect(comment?.memberId).toBeNull();
        const [shadow] = yield* db
          .select()
          .from(schema.userTable)
          .where(eq(schema.userTable.id, comment?.userId ?? ""))
          .limit(1);
        expect(shadow?.email).toMatch(/^behalf-[0-9a-f]+@feeblo\.com$/);

        // The write lands in the post's timeline with no actor, because a
        // machine credential has no user behind it.
        const [activity] = yield* db
          .select()
          .from(schema.postActivityTable)
          .where(
            and(
              eq(schema.postActivityTable.postId, workspace.postId),
              eq(schema.postActivityTable.kind, "COMMENT_CREATED"),
              eq(schema.postActivityTable.commentId, created.id)
            )
          )
          .limit(1);
        expect(activity).toMatchObject({ actorId: null, actorMemberId: null });

        // The comment the response described is the comment a later read
        // returns.
        const again = yield* executeRequest(
          `/api/v1/comments/${created.id}`,
          "fbk_comments_write"
        );
        expect(again.status).toBe(200);
        expect(decodeComment(responseBody(again)).id).toBe(created.id);
      })
  );

  it.effect("refuses a comment write without the write scopes", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      yield* seedComment(
        workspace.organizationId,
        workspace.postId,
        "cmt_scoped"
      );
      registerKey("fbk_comments_readonly", workspace.organizationId);

      const cases = [
        {
          method: "POST" as const,
          path: `/api/v1/posts/${workspace.postId}/comments`,
          scope: "comments.create",
          body: { content: "Nope", author: { email: "jane@example.com" } },
        },
        {
          method: "PATCH" as const,
          path: "/api/v1/comments/cmt_scoped",
          scope: "comments.update",
          body: { content: "Nope" },
        },
        {
          method: "DELETE" as const,
          path: "/api/v1/comments/cmt_scoped",
          scope: "comments.delete",
        },
        {
          method: "POST" as const,
          path: "/api/v1/comments/cmt_scoped/pin",
          scope: "comments.pin",
        },
        {
          method: "POST" as const,
          path: "/api/v1/comments/cmt_scoped/unpin",
          scope: "comments.pin",
        },
      ];

      for (const entry of cases) {
        const response = yield* executeWrite(entry.method, entry.path, {
          apiKey: "fbk_comments_readonly",
          ...("body" in entry && { body: entry.body }),
        });

        expect(response.status).toBe(403);
        const body = decodeError(responseBody(response));
        expect(body._tag).toBe("FORBIDDEN_SCOPE");
        expect(body.message).toContain(entry.scope);
      }

      // A read key still reads: the write scopes are the only thing missing.
      const read = yield* executeRequest(
        "/api/v1/comments/cmt_scoped",
        "fbk_comments_readonly"
      );
      expect(read.status).toBe(200);
    })
  );

  it.effect("refuses to comment on a locked post", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      const db = yield* currentDb;
      registerKey(
        "fbk_comments_locked",
        workspace.organizationId,
        COMMENT_MANAGEMENT_KEY_SCOPES
      );

      yield* db
        .update(schema.postTable)
        .set({ lockedAt: new Date() })
        .where(eq(schema.postTable.id, workspace.postId));

      const response = yield* executeWrite(
        "POST",
        `/api/v1/posts/${workspace.postId}/comments`,
        {
          apiKey: "fbk_comments_locked",
          body: {
            content: "Should not land",
            author: { email: "jane@example.com" },
          },
        }
      );

      expect(response.status).toBe(409);
      expect(decodeError(responseBody(response))._tag).toBe("CONFLICT");
    })
  );

  it.effect("refuses to comment on a post merged into another", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace({ postCount: 2 });
      const db = yield* currentDb;
      registerKey(
        "fbk_comments_merged",
        workspace.organizationId,
        COMMENT_MANAGEMENT_KEY_SCOPES
      );

      // A merged post redirects to its survivor and every interaction gate
      // treats it as read-only until it is unmerged. The check constraints
      // require a merge timestamp and an archived source, so both are set.
      yield* db
        .update(schema.postTable)
        .set({
          archivedAt: new Date(),
          mergedAt: new Date(),
          mergedIntoPostId: `${workspace.postId}_1`,
        })
        .where(eq(schema.postTable.id, workspace.postId));

      const response = yield* executeWrite(
        "POST",
        `/api/v1/posts/${workspace.postId}/comments`,
        {
          apiKey: "fbk_comments_merged",
          body: {
            content: "Should not land",
            author: { email: "jane@example.com" },
          },
        }
      );

      expect(response.status).toBe(409);
      expect(decodeError(responseBody(response))._tag).toBe("CONFLICT");
    })
  );

  it.effect("rejects a parent comment from another post", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace({ postCount: 2 });
      const otherPostId = `${workspace.postId}_1`;
      yield* seedComment(
        workspace.organizationId,
        otherPostId,
        "cmt_other_post"
      );
      registerKey(
        "fbk_comments_parent",
        workspace.organizationId,
        COMMENT_MANAGEMENT_KEY_SCOPES
      );

      // The foreign key would accept any existing comment id, so the write
      // path is what keeps a reply from anchoring across a post boundary.
      const response = yield* executeWrite(
        "POST",
        `/api/v1/posts/${workspace.postId}/comments`,
        {
          apiKey: "fbk_comments_parent",
          body: {
            content: "Reply",
            parentCommentId: "cmt_other_post",
            author: { email: "jane@example.com" },
          },
        }
      );

      expect(response.status).toBe(400);
      expect(decodeError(responseBody(response))._tag).toBe("INVALID_REQUEST");
    })
  );

  it.effect("updates a comment's body and visibility", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      yield* seedComment(
        workspace.organizationId,
        workspace.postId,
        "cmt_edit"
      );
      registerKey(
        "fbk_comments_edit",
        workspace.organizationId,
        COMMENT_MANAGEMENT_KEY_SCOPES
      );

      const response = yield* executeWrite(
        "PATCH",
        "/api/v1/comments/cmt_edit",
        {
          apiKey: "fbk_comments_edit",
          body: { content: "Edited body", visibility: "INTERNAL" },
        }
      );

      expect(response.status).toBe(200);
      const edited = decodeComment(responseBody(response));
      expect(edited).toMatchObject({
        id: "cmt_edit",
        visibility: "INTERNAL",
      });
      // The body is stored as sanitized markdown, which normalizes a trailing
      // newline; compare on content rather than on an exact byte string.
      expect(edited.content.trim()).toBe("Edited body");

      // Omitting visibility leaves it alone rather than resetting it.
      const bodyOnly = yield* executeWrite(
        "PATCH",
        "/api/v1/comments/cmt_edit",
        { apiKey: "fbk_comments_edit", body: { content: "Body only" } }
      );
      expect(bodyOnly.status).toBe(200);
      expect(decodeComment(responseBody(bodyOnly))).toMatchObject({
        visibility: "INTERNAL",
      });
    })
  );

  it.effect("refuses to widen a reply beyond its internal parent", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      yield* seedComment(
        workspace.organizationId,
        workspace.postId,
        "cmt_internal_parent",
        { visibility: "INTERNAL" }
      );
      yield* seedComment(
        workspace.organizationId,
        workspace.postId,
        "cmt_internal_reply",
        { parentCommentId: "cmt_internal_parent", visibility: "INTERNAL" }
      );
      yield* seedComment(
        workspace.organizationId,
        workspace.postId,
        "cmt_public_parent"
      );
      yield* seedComment(
        workspace.organizationId,
        workspace.postId,
        "cmt_public_reply",
        { parentCommentId: "cmt_public_parent" }
      );
      registerKey(
        "fbk_comments_visibility",
        workspace.organizationId,
        COMMENT_MANAGEMENT_KEY_SCOPES
      );

      // A create refuses a PUBLIC reply under an INTERNAL parent, so an edit
      // that only flips visibility must not be a way around that rule.
      const widened = yield* executeWrite(
        "PATCH",
        "/api/v1/comments/cmt_internal_reply",
        {
          apiKey: "fbk_comments_visibility",
          body: { content: "Now public", visibility: "PUBLIC" },
        }
      );
      expect(widened.status).toBe(400);
      expect(decodeError(responseBody(widened))._tag).toBe("INVALID_REQUEST");

      // The comment is untouched: the refusal is not a partial write.
      const after = yield* executeRequest(
        "/api/v1/comments/cmt_internal_reply",
        "fbk_comments_visibility"
      );
      expect(decodeComment(responseBody(after))).toMatchObject({
        content: "Seeded comment",
        visibility: "INTERNAL",
      });

      // A reply under a PUBLIC parent is free to move between visibilities.
      const narrowed = yield* executeWrite(
        "PATCH",
        "/api/v1/comments/cmt_public_reply",
        {
          apiKey: "fbk_comments_visibility",
          body: { content: "Note to the team", visibility: "INTERNAL" },
        }
      );
      expect(narrowed.status).toBe(200);
      expect(decodeComment(responseBody(narrowed)).visibility).toBe("INTERNAL");

      const reopened = yield* executeWrite(
        "PATCH",
        "/api/v1/comments/cmt_public_reply",
        {
          apiKey: "fbk_comments_visibility",
          body: { content: "Visible again", visibility: "PUBLIC" },
        }
      );
      expect(reopened.status).toBe(200);
      expect(decodeComment(responseBody(reopened)).visibility).toBe("PUBLIC");

      // Narrowing the parent leaves the reply public beneath an internal
      // comment. That state is the parent's doing, so an edit of the reply
      // that carries the visibility it already has is not refused: only a
      // change to PUBLIC is the edit this rule is about, and the author can
      // still edit their own body.
      const narrowedParent = yield* executeWrite(
        "PATCH",
        "/api/v1/comments/cmt_public_parent",
        {
          apiKey: "fbk_comments_visibility",
          body: { content: "Seeded comment", visibility: "INTERNAL" },
        }
      );
      expect(narrowedParent.status).toBe(200);

      const bodyEdit = yield* executeWrite(
        "PATCH",
        "/api/v1/comments/cmt_public_reply",
        {
          apiKey: "fbk_comments_visibility",
          body: { content: "Edited body", visibility: "PUBLIC" },
        }
      );
      expect(bodyEdit.status).toBe(200);
      expect(decodeComment(responseBody(bodyEdit))).toMatchObject({
        content: "Edited body\n",
        visibility: "PUBLIC",
      });
    })
  );

  it.effect("refuses an empty comment body", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      yield* seedComment(
        workspace.organizationId,
        workspace.postId,
        "cmt_empty"
      );
      registerKey(
        "fbk_comments_empty",
        workspace.organizationId,
        COMMENT_MANAGEMENT_KEY_SCOPES
      );

      const created = yield* executeWrite(
        "POST",
        `/api/v1/posts/${workspace.postId}/comments`,
        {
          apiKey: "fbk_comments_empty",
          body: { content: "", author: { email: "jane@example.com" } },
        }
      );
      expect(created.status).toBe(400);
      expect(decodeError(responseBody(created))._tag).toBe("INVALID_REQUEST");

      const updated = yield* executeWrite(
        "PATCH",
        "/api/v1/comments/cmt_empty",
        { apiKey: "fbk_comments_empty", body: { content: "" } }
      );
      expect(updated.status).toBe(400);
      expect(decodeError(responseBody(updated))._tag).toBe("INVALID_REQUEST");

      // A body that is not the empty string but sanitizes to nothing is the
      // same outcome: a comment that renders as nothing must not be stored.
      const blankCreate = yield* executeWrite(
        "POST",
        `/api/v1/posts/${workspace.postId}/comments`,
        {
          apiKey: "fbk_comments_empty",
          body: { content: "   ", author: { email: "jane@example.com" } },
        }
      );
      expect(blankCreate.status).toBe(400);
      expect(decodeError(responseBody(blankCreate))._tag).toBe(
        "INVALID_REQUEST"
      );

      const blankUpdate = yield* executeWrite(
        "PATCH",
        "/api/v1/comments/cmt_empty",
        { apiKey: "fbk_comments_empty", body: { content: "   " } }
      );
      expect(blankUpdate.status).toBe(400);
      expect(decodeError(responseBody(blankUpdate))._tag).toBe(
        "INVALID_REQUEST"
      );

      // The stored body is untouched by the refused writes.
      const after = yield* executeRequest(
        "/api/v1/comments/cmt_empty",
        "fbk_comments_empty"
      );
      expect(decodeComment(responseBody(after)).content).toBe("Seeded comment");
    })
  );

  it.effect("deletes a comment together with its replies", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      yield* seedComment(
        workspace.organizationId,
        workspace.postId,
        "cmt_parent"
      );
      yield* seedComment(
        workspace.organizationId,
        workspace.postId,
        "cmt_reply",
        { parentCommentId: "cmt_parent" }
      );
      registerKey(
        "fbk_comments_delete",
        workspace.organizationId,
        COMMENT_MANAGEMENT_KEY_SCOPES
      );

      const response = yield* executeWrite(
        "DELETE",
        "/api/v1/comments/cmt_parent",
        { apiKey: "fbk_comments_delete" }
      );
      expect(response.status).toBe(204);

      const after = yield* executeRequest(
        "/api/v1/comments/cmt_parent",
        "fbk_comments_delete"
      );
      expect(after.status).toBe(404);

      // `parent_comment_id` cascades, so the reply went with it.
      const reply = yield* executeRequest(
        "/api/v1/comments/cmt_reply",
        "fbk_comments_delete"
      );
      expect(reply.status).toBe(404);
    })
  );

  it.effect("pins one comment per post and unpins idempotently", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      yield* seedComment(
        workspace.organizationId,
        workspace.postId,
        "cmt_first",
        { createdAt: new Date(Date.now() - 60_000) }
      );
      yield* seedComment(
        workspace.organizationId,
        workspace.postId,
        "cmt_second"
      );
      registerKey(
        "fbk_comments_pin",
        workspace.organizationId,
        COMMENT_MANAGEMENT_KEY_SCOPES
      );

      const pinned = yield* executeWrite(
        "POST",
        "/api/v1/comments/cmt_first/pin",
        { apiKey: "fbk_comments_pin" }
      );
      expect(pinned.status).toBe(200);
      expect(decodeComment(responseBody(pinned)).pinnedAt).not.toBeNull();

      // A post has one pinned comment: pinning the second releases the first.
      const repinned = yield* executeWrite(
        "POST",
        "/api/v1/comments/cmt_second/pin",
        { apiKey: "fbk_comments_pin" }
      );
      expect(repinned.status).toBe(200);
      expect(decodeComment(responseBody(repinned)).pinnedAt).not.toBeNull();

      const first = yield* executeRequest(
        "/api/v1/comments/cmt_first",
        "fbk_comments_pin"
      );
      expect(decodeComment(responseBody(first)).pinnedAt).toBeNull();

      const unpinned = yield* executeWrite(
        "POST",
        "/api/v1/comments/cmt_second/unpin",
        { apiKey: "fbk_comments_pin" }
      );
      expect(unpinned.status).toBe(200);
      expect(decodeComment(responseBody(unpinned)).pinnedAt).toBeNull();

      // Unpinning a comment that is not pinned changes nothing, so a retry is
      // answered the same way rather than failing.
      const again = yield* executeWrite(
        "POST",
        "/api/v1/comments/cmt_second/unpin",
        { apiKey: "fbk_comments_pin" }
      );
      expect(again.status).toBe(200);
      expect(decodeComment(responseBody(again)).pinnedAt).toBeNull();
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
        "/api/v1/changelog",
        "/api/v1/changelog/{changelogId}",
        "/api/v1/comments/{commentId}",
        "/api/v1/comments/{commentId}/pin",
        "/api/v1/comments/{commentId}/unpin",
        "/api/v1/companies",
        "/api/v1/companies/{companyId}",
        "/api/v1/posts",
        "/api/v1/posts/retrieve",
        "/api/v1/posts/{postId}",
        "/api/v1/posts/{postId}/comments",
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

/**
 * The MCP projection of the Public API.
 *
 * Drives `/mcp` through the production Streamable HTTP transport — initialize,
 * list, call — over the same real key, plan, and repository composition the
 * HTTP suite uses. The projection itself (tool/operation parity, annotations,
 * object-rooted input schemas) is pinned in `mcp.test.ts`; what these cover is
 * that a client's calls reach the same handlers through the same gate, and that
 * a refused call reads the same as it does on `/api/v1`.
 */

/** What a `POST /mcp` may ask for; the transport rejects a partial accept. */
const MCP_ACCEPT = "application/json, text/event-stream";

const executeMcp = (options: {
  readonly apiKey?: string;
  readonly body: unknown;
  readonly protocolVersion?: string;
  readonly sessionId?: string;
}) =>
  Effect.gen(function* () {
    const headers = new Headers({
      accept: MCP_ACCEPT,
      "content-type": "application/json",
    });
    if (options.apiKey !== undefined) {
      headers.set("x-api-key", options.apiKey);
    }
    if (options.protocolVersion !== undefined) {
      headers.set("mcp-protocol-version", options.protocolVersion);
    }
    if (options.sessionId !== undefined) {
      headers.set("mcp-session-id", options.sessionId);
    }

    const request = HttpServerRequest.fromWeb(
      new Request("http://localhost/mcp", {
        body: JSON.stringify(options.body),
        headers,
        method: "POST",
      })
    );
    const handled =
      yield* Deferred.make<HttpServerResponse.HttpServerResponse>();

    // `asHttpEffect` returns the route's response directly, but the MCP
    // transport attaches its session header in a pre-response handler, which
    // only the server loop applies. Running `HttpEffect.toHandled` keeps the
    // test on the production path, so the session a test continues with is the
    // one a real client would receive.
    yield* HttpEffect.toHandled(
      Effect.flatMap(HttpRouter.HttpRouter, (router) => router.asHttpEffect()),
      (_request, response) => Deferred.succeed(handled, response)
    ).pipe(Effect.provideService(HttpServerRequest.HttpServerRequest, request));

    return yield* Deferred.await(handled);
  });

/**
 * The JSON-RPC message a response carried.
 *
 * A single message is answered as JSON and a message surrounded by
 * notifications is streamed as Server-Sent Events; one reader handles both so a
 * test does not depend on which shape a given call takes.
 */
const decodeJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Unknown)
);

const mcpMessage = (response: HttpServerResponse.HttpServerResponse) =>
  Effect.promise(async () => {
    const text = await HttpServerResponse.toWeb(response).text();
    const events = text
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice("data: ".length));

    return decodeJson(events.at(-1) ?? text);
  });

const McpJsonRpcMessage = Schema.Struct({
  error: Schema.optional(
    Schema.Struct({ code: Schema.Number, message: Schema.String })
  ),
  id: Schema.Union([Schema.String, Schema.Number]),
  jsonrpc: Schema.Literal("2.0"),
  result: Schema.optional(Schema.Unknown),
});

const decodeMcpMessage = Schema.decodeUnknownSync(McpJsonRpcMessage);

/** The tools a `tools/list` answered with, validated by the protocol's own schema. */
const McpToolsList = Schema.Struct({
  tools: Schema.Array(McpSchema.Tool),
});

const decodeToolList = Schema.decodeUnknownSync(McpToolsList);

/** A tool-call result, decoded with the schema a client reads it with. */
const decodeCallToolResult = Schema.decodeUnknownSync(McpSchema.CallToolResult);

const MCP_PROTOCOL_VERSION = "2025-06-18";

const MCP_INITIALIZE = {
  id: 1,
  jsonrpc: "2.0",
  method: "initialize",
  params: {
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" },
    protocolVersion: MCP_PROTOCOL_VERSION,
  },
} as const;

/** Runs the handshake and returns the session a client would keep sending. */
const openMcpSession = (apiKey: string) =>
  Effect.gen(function* () {
    const initialized = yield* executeMcp({ apiKey, body: MCP_INITIALIZE });
    const sessionId = initialized.headers["mcp-session-id"];
    if (sessionId === undefined) {
      return yield* Effect.die("the MCP handshake did not open a session");
    }
    return sessionId;
  });

/** One `tools/call`, through the same session a client would use. */
const callTool = (
  sessionId: string,
  apiKey: string,
  name: string,
  toolArguments: Schema.JsonObject
) =>
  Effect.gen(function* () {
    const response = yield* executeMcp({
      apiKey,
      body: {
        id: 2,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: toolArguments, name },
      },
      protocolVersion: MCP_PROTOCOL_VERSION,
      sessionId,
    });
    expect(response.status).toBe(200);

    const message = decodeMcpMessage(yield* mcpMessage(response));
    if (message.result === undefined) {
      return yield* Effect.die(
        `the tool call did not return a result: ${JSON.stringify(message.error)}`
      );
    }
    return decodeCallToolResult(message.result);
  });

layer(
  makePublicApiMcpRoute().pipe(
    Layer.provideMerge(PublicApiDependencies),
    Layer.provideMerge(HttpRouter.layer)
  )
)("public api mcp", (it) => {
  it.effect(
    "answers an initialize handshake and lists every operation as a tool",
    () =>
      Effect.gen(function* () {
        const workspace = yield* seedWorkspace();
        registerKey("fbk_mcp_list", workspace.organizationId);

        const initialized = yield* executeMcp({
          apiKey: "fbk_mcp_list",
          body: MCP_INITIALIZE,
        });
        expect(initialized.status).toBe(200);
        expect(initialized.headers["mcp-session-id"]).toBeDefined();

        const sessionId = yield* openMcpSession("fbk_mcp_list");
        const listed = yield* executeMcp({
          apiKey: "fbk_mcp_list",
          body: { id: 2, jsonrpc: "2.0", method: "tools/list", params: {} },
          protocolVersion: MCP_PROTOCOL_VERSION,
          sessionId,
        });
        expect(listed.status).toBe(200);

        const message = decodeMcpMessage(yield* mcpMessage(listed));
        const tools = decodeToolList(message.result);
        expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
          PublicApiOperations.map((operation) => operation.name).sort()
        );

        // One tool checked against its operation: the descriptor is the same
        // description, annotations, and input schema the endpoint publishes,
        // so a client is not deciding with a second, thinner contract.
        const listTagsOperation = PublicApiOperations.find(
          (operation) => operation.name === "listTags"
        );
        const listTags = tools.tools.find((tool) => tool.name === "listTags");
        expect(listTags?.description).toBe(listTagsOperation?.description);
        expect(listTags?.annotations?.readOnlyHint).toBe(
          listTagsOperation?.annotations.readOnly
        );
        expect(listTags?.annotations?.idempotentHint).toBe(
          listTagsOperation?.annotations.idempotent
        );
        expect(Object.keys(listTags?.inputSchema.properties ?? {})).toEqual([
          "cursor",
          "limit",
        ]);
      })
  );

  it.effect("calls a read tool and returns its published page", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey("fbk_mcp_call", workspace.organizationId);
      yield* seedTag(workspace.organizationId, "tag_mcp_read", "Bug");

      const sessionId = yield* openMcpSession("fbk_mcp_call");
      const result = yield* callTool(sessionId, "fbk_mcp_call", "listTags", {});
      expect(result.isError).toBe(false);

      const page = yield* Schema.decodeUnknownEffect(PublicApiTagPage)(
        result.structuredContent
      );
      expect(page.data.map((tag) => tag.name)).toEqual(["Bug"]);
    })
  );

  it.effect("refuses a tool the key has no scope for", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey("fbk_mcp_scope", workspace.organizationId, {
        boards: ["read"],
      });

      const sessionId = yield* openMcpSession("fbk_mcp_scope");
      const result = yield* callTool(
        sessionId,
        "fbk_mcp_scope",
        "listTags",
        {}
      );
      expect(result.isError).toBe(true);

      // The scope is a per-call failure, not a timeout or a protocol error: the
      // operation's own gate answered, and the server encoded its published
      // failure as the tool result's text, which is what a client shows its
      // model so it can pick a key that holds the scope.
      const [content] = result.content;
      if (content?.type !== "text") {
        return yield* Effect.die("the refusal carried no text content");
      }
      expect(content.text).toContain("tags.read");
    })
  );

  it.effect("rejects parameters the operation's schema refuses", () =>
    Effect.gen(function* () {
      const workspace = yield* seedWorkspace();
      registerKey("fbk_mcp_invalid", workspace.organizationId);

      const sessionId = yield* openMcpSession("fbk_mcp_invalid");
      const response = yield* executeMcp({
        apiKey: "fbk_mcp_invalid",
        body: {
          id: 3,
          jsonrpc: "2.0",
          method: "tools/call",
          params: { arguments: { limit: "many" }, name: "listTags" },
        },
        protocolVersion: MCP_PROTOCOL_VERSION,
        sessionId,
      });
      expect(response.status).toBe(200);

      // A parameter the tool's schema refuses is a protocol error, not an
      // `isError` result: the call never reached the operation, and a client
      // sees a failed call rather than a tool that answered it.
      const message = decodeMcpMessage(yield* mcpMessage(response));
      expect(message.result).toBeUndefined();
      expect(message.error?.code).toBe(-32_602);
    })
  );

  it.effect("refuses a request with no key", () =>
    Effect.gen(function* () {
      const response = yield* executeMcp({ body: MCP_INITIALIZE });
      expect(response.status).toBe(401);
      expect(decodeError(responseBody(response))._tag).toBe("MISSING_API_KEY");
    })
  );

  it.effect("refuses an unknown key", () =>
    Effect.gen(function* () {
      const response = yield* executeMcp({
        apiKey: "fbk_mcp_unknown",
        body: MCP_INITIALIZE,
      });
      expect(response.status).toBe(401);
      expect(decodeError(responseBody(response))._tag).toBe("INVALID_API_KEY");
    })
  );
});
