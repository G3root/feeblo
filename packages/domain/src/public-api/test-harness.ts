import {
  NodeCrypto,
  NodeHttpPlatform,
  NodeServices,
} from "@effect/platform-node";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  BoardId,
  ChangelogId,
  PostId,
  PostStatusId,
  WorkspaceId,
} from "@feeblo/id";
import { IntegrationEventRecorderLive } from "@feeblo/integration-core";
import { slugify } from "@feeblo/utils/url";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Etag from "effect/http/Etag";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { ApiKeyAuthRecord } from "../api-key/schema";
import { Auth } from "../auth-handler";
import { BoardRepository } from "../board/repository";
import { CompanyRepository } from "../company/repository";
import { EmailOutboxConfig } from "../email-outbox/config";
import { EmailOutboxRepository } from "../email-outbox/repository";
import { EmailSubscriptionRepository } from "../email-subscription/repository";
import { EmailSubscriptionTokenService } from "../email-subscription/tokens";
import { EntitlementPolicy } from "../entitlement/policies";
import { ResolvePrincipalService } from "../identity/service";
import { NotificationService } from "../notification/service";
import { PolicyDeniedError } from "../policy";
import { PostActivityRepository } from "../post-activity/repository";
import { PostSubscriptionRepository } from "../post-subscription/repository";
import { PostEmbeddingService } from "../post/embedding-service";
import { PostRepository } from "../post/repository";
import { PostWriteService } from "../post/write";
import { RateLimitService } from "../rate-limit/service";
import { S3Test } from "../services/s3-test";
import { UserRepository } from "../user/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { PublicApiConfig } from "./config";

/**
 * The live composition and fixtures the Public API's test modules share.
 *
 * `/api/v1` and `/mcp` are driven through the production layer assembly, real
 * PGlite database, and the same key verifier, so both surfaces' tests exercise
 * the one app that ships. The pieces no single test file owns — the dependency
 * bundle, the seeded rows, the scope grants a key is registered with, and the
 * error envelope a response is decoded by — live here so a change to the
 * wiring is one edit instead of one per surface.
 */

/** The `Date` for a known instant, built through `DateTime`. */
export const dateAt = (instant: string | number | Date): Date =>
  DateTime.toDateUtc(DateTime.makeUnsafe(instant));

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

/** The error envelope every Public API refusal is published as. */
const ErrorEnvelope = Schema.Struct({
  _tag: Schema.String,
  message: Schema.String,
});

/** Decodes a response body into the published error envelope. */
export const decodeError = Schema.decodeUnknownSync(
  Schema.fromJsonString(ErrorEnvelope)
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
export const makePublicApiDependencies = (
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
                  return yield* new PolicyDeniedError({
                    reason: "The plan has no room.",
                  });
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

  const SharedDependencies = Layer.mergeAll(
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
    NodeServices.layer,
    // The post write path's own collaborators. The shared service owns them
    // now, so the test supplies them here instead of through the route's
    // internals.
    BoardRepository.layer,
    IntegrationEventRecorderLive,
    NotificationService.layer,
    PostActivityRepository.layer,
    PostEmbeddingService.layer,
    PostRepository.layer,
    PostSubscriptionRepository.layer,
    ResolvePrincipalService.layer,
    UserRepository.layer
  );

  // The route requires the service; merging rather than only providing keeps
  // the shared dependencies in the test layer's output so test bodies can seed
  // fixtures through `currentDb`.
  return PostWriteService.layer.pipe(
    Layer.provideMerge(SharedDependencies),
    Layer.provideMerge(Database.PgliteDatabaseLive)
  );
};

/** The production wiring, with only the substitutes a test must supply. */
export const PublicApiDependencies = makePublicApiDependencies();

/** The response body as text, for a test that decodes it by hand. */
export const responseBody = (
  response: HttpServerResponse.HttpServerResponse
) => {
  const body = response.body;
  return body._tag === "Uint8Array" ? new TextDecoder().decode(body.body) : "";
};

/** The rows `seedWorkspace` inserted, by the names a test reads them with. */
export type SeededWorkspace = {
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
export const seedTag = (
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
export const seedChangelog = (
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
    const id = options.id ?? (yield* ChangelogId.generate);
    const title = options.title ?? "Release notes";
    const now = options.createdAt ?? (yield* DateTime.nowAsDate);
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
export const seedCompany = (
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
    const createdAt = options.createdAt ?? (yield* DateTime.nowAsDate);
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
export const seedComment = (
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
    const now = options.createdAt ?? (yield* DateTime.nowAsDate);

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

/**
 * Inserts a workspace with a board, a status, and posts, and grants it the
 * Starter plan unless asked for a free one.
 */
export const seedWorkspace = (
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
    const now = yield* DateTime.nowAsDate;

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
        createdAt: dateAt(now.getTime() - index * 60_000),
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
        currentPeriodEnd: dateAt(now.getTime() + 30 * 24 * 60 * 60 * 1000),
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
export const READ_KEY_SCOPES = {
  boards: ["read"],
  posts: ["read"],
  comments: ["read"],
  votes: ["read"],
  tags: ["read"],
  changelog: ["read"],
};

/** The tag reads plus every tag write, the assignment included. */
export const TAG_MANAGEMENT_KEY_SCOPES = {
  boards: ["read"],
  posts: ["read"],
  tags: ["read", "create", "update", "delete", "assign"],
};

/** The changelog reads plus every changelog write, publish included. */
export const CHANGELOG_MANAGEMENT_KEY_SCOPES = {
  boards: ["read"],
  posts: ["read"],
  tags: ["read"],
  changelog: ["read", "create", "update", "delete", "publish"],
};

/** The changelog writes without the publish scope. */
export const CHANGELOG_EDITOR_KEY_SCOPES = {
  boards: ["read"],
  posts: ["read"],
  tags: ["read"],
  changelog: ["read", "create", "update", "delete"],
};

/**
 * The CRM grant, which is not implied by the read scopes: a key minted to read
 * feedback does not learn the workspace's customers.
 */
export const COMPANY_MANAGEMENT_KEY_SCOPES = {
  boards: ["read"],
  posts: ["read"],
  tags: ["read"],
  companies: ["read", "create", "update", "delete"],
};

/** The post reads plus every post write, merge included. */
export const POST_MANAGEMENT_KEY_SCOPES = {
  boards: ["read"],
  posts: ["read", "create", "update", "delete", "merge"],
  tags: ["read"],
};

/** The post writes without the delete scope, to pin that it is required. */
export const POST_EDITOR_KEY_SCOPES = {
  boards: ["read"],
  posts: ["read", "create", "update"],
  tags: ["read"],
};

/**
 * The comment grant: the reads every key now receives, plus every comment
 * write. Written out rather than imported so the test pins the vocabulary
 * instead of tracking it.
 */
export const COMMENT_MANAGEMENT_KEY_SCOPES = {
  boards: ["read"],
  posts: ["read"],
  comments: ["read", "create", "update", "delete", "pin"],
  tags: ["read"],
};

/** The vote reads plus every vote write, as a key is created with them. */
export const VOTE_MANAGEMENT_KEY_SCOPES = {
  boards: ["read"],
  posts: ["read"],
  votes: ["read", "create", "delete"],
};

/**
 * The end-user capability, which is not implied by the read scopes: a key
 * minted to read feedback does not learn the workspace's customers.
 */
export const END_USER_MANAGEMENT_KEY_SCOPES = {
  boards: ["read"],
  posts: ["read"],
  end_users: ["read", "write"],
};

/**
 * Registers the key the stub verifier accepts, so a test's next request
 * authenticates as that workspace with those scopes.
 */
export const registerKey = (
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
