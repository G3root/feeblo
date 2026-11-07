import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  IntegrationExternalResourceType,
  IntegrationProviderKey,
} from "@feeblo/db/validation-schema/integration";
import {
  BoardId,
  IntegrationConnectionId,
  type LegidOf,
  PostId,
  PostStatusId,
  WorkspaceId,
} from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import { TestClock } from "effect/testing";

import { ExternalResourceServiceLive } from "./live";
import { ExternalResourceService } from "./service";

const TestLayer = Layer.mergeAll(
  ExternalResourceServiceLive.pipe(Layer.provide(Database.PgliteDatabaseLive)),
  Database.PgliteDatabaseLive
);

const seedPost = (suffix: string) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const organizationId = yield* WorkspaceId.generate;
    const boardId = yield* BoardId.generate;
    const statusId = yield* PostStatusId.generate;
    const postId = yield* PostId.generate;
    const now = yield* DateTime.nowAsDate;
    yield* db.insert(schema.organizationTable).values({
      id: organizationId,
      name: `External resource ${suffix}`,
      slug: `external-resource-${suffix}-${organizationId}`,
      createdAt: now,
    });
    yield* db.insert(schema.boardTable).values({
      id: boardId,
      organizationId,
      name: "Feedback",
      slug: `feedback-${suffix}`,
      visibility: "PRIVATE",
      createdAt: now,
      updatedAt: now,
    });
    yield* db.insert(schema.postStatusTable).values({
      id: statusId,
      organizationId,
      type: "PENDING",
      orderIndex: 0,
    });
    yield* db.insert(schema.postTable).values({
      id: postId,
      organizationId,
      boardId,
      statusId,
      title: "Feedback",
      slug: `feedback-${suffix}`,
      content: "Content",
      createdAt: now,
      updatedAt: now,
    });
    return { organizationId, postId, boardId, statusId };
  });

const seedPostInOrganization = (
  organizationId: LegidOf<"WorkspaceId">,
  boardId: LegidOf<"BoardId">,
  statusId: LegidOf<"PostStatusId">,
  suffix: string
) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const postId = yield* PostId.generate;
    const now = yield* DateTime.nowAsDate;
    yield* db.insert(schema.postTable).values({
      id: postId,
      organizationId,
      boardId,
      statusId,
      title: "Feedback",
      slug: `feedback-${suffix}`,
      content: "Content",
      createdAt: now,
      updatedAt: now,
    });
    return { organizationId, postId };
  });

const seedConnection = (
  organizationId: LegidOf<"WorkspaceId">,
  provider: string
) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const connectionId = yield* IntegrationConnectionId.generate;
    yield* db.insert(schema.integrationConnectionTable).values({
      id: connectionId,
      organizationId,
      provider: IntegrationProviderKey.make(provider),
      name: `${provider} connection`,
      lifecycle: "active",
    });
    return connectionId;
  });

const resource = (
  organizationId: LegidOf<"WorkspaceId">,
  connectionId: LegidOf<"IntegrationConnectionId">
) => ({
  organizationId,
  connectionId,
  resourceType: IntegrationExternalResourceType.make("issue"),
  remoteId: "ISSUE-123",
  remoteUrl: new URL("https://example.test/issues/ISSUE-123"),
  displayKey: "ISSUE-123",
  title: "A linked issue",
  stateKey: "open",
  safeMetadata: {},
});

describe("external resource service", () => {
  layer(TestLayer)("generic resource persistence", (it) => {
    it.effect(
      "lists cross-provider links, upserts duplicate remotes, links one resource to two posts, and reserves creation idempotently",
      () =>
        Effect.gen(function* () {
          const service = yield* ExternalResourceService;
          const first = yield* seedPost("first");
          const second = yield* seedPostInOrganization(
            first.organizationId,
            first.boardId,
            first.statusId,
            "second"
          );
          const github = yield* seedConnection(first.organizationId, "github");
          const linear = yield* seedConnection(first.organizationId, "linear");

          const githubFirst = yield* service.recordPostLink({
            postId: first.postId,
            resource: resource(first.organizationId, github),
          });
          const githubDuplicate = yield* service.recordPostLink({
            postId: first.postId,
            resource: {
              ...resource(first.organizationId, github),
              title: "Updated title",
            },
          });
          expect(githubDuplicate.externalResourceId).toBe(
            githubFirst.externalResourceId
          );
          expect(githubDuplicate.postExternalResourceLinkId).toBe(
            githubFirst.postExternalResourceLinkId
          );
          const afterDuplicate = yield* service.listPostLinks(first);
          expect(afterDuplicate[0]?.title).toBe("Updated title");

          yield* service.recordPostLink({
            postId: second.postId,
            resource: resource(first.organizationId, github),
          });
          yield* service.recordPostLink({
            postId: first.postId,
            resource: {
              ...resource(first.organizationId, linear),
              remoteId: "LIN-99",
              displayKey: "LIN-99",
            },
          });

          const firstLinks = yield* service.listPostLinks(first);
          expect(firstLinks).toHaveLength(2);
          expect(firstLinks.map((link) => link.provider).sort()).toEqual([
            "github",
            "linear",
          ]);
          const secondLinks = yield* service.listPostLinks(second);
          expect(secondLinks).toHaveLength(1);
          expect(secondLinks[0]?.id).not.toBe(
            githubFirst.postExternalResourceLinkId
          );

          const reserved = yield* service.reserveCreation({
            connectionId: github,
            organizationId: first.organizationId,
            postId: first.postId,
            idempotencyKey: "create-github-issue",
          });
          const duplicate = yield* service.reserveCreation({
            connectionId: github,
            organizationId: first.organizationId,
            postId: first.postId,
            idempotencyKey: "create-github-issue",
          });
          expect(reserved.reserved).toBe(true);
          expect(duplicate.reserved).toBe(false);
          expect(duplicate.id).toBe(reserved.id);
          if (!reserved.reserved) {
            return yield* Effect.die("Expected the first reservation to win");
          }
          yield* service.failCreation({
            requestId: reserved.id,
            reservedAt: reserved.reservedAt,
          });
          const retried = yield* service.reserveCreation({
            connectionId: github,
            organizationId: first.organizationId,
            postId: first.postId,
            idempotencyKey: "create-github-issue",
          });
          expect(retried.reserved).toBe(true);
        })
    );

    /**
     * The reservation is the idempotency key's mutex: exactly one caller may
     * hold it and run the provider call.
     *
     * These are contract tests, not race tests. The re-claim used to read the
     * row and then guard an `UPDATE` on it, and the guarded `UPDATE` never read
     * its row count, so the loser of a race went on to create the resource
     * anyway. The fix is structural — taking the reservation over is now a
     * single statement, so the row the first caller moves cannot satisfy the
     * predicate the second one evaluates. PGlite runs one connection and does
     * not interleave the two fibers here, so a test cannot reproduce the race
     * that motivated it; what these two pin is the contract the fix preserves:
     * one holder, and a loser that reports "already pending" rather than
     * running the provider call.
     */
    const reservationRace = (suffix: string) =>
      Effect.gen(function* () {
        const post = yield* seedPost(suffix);
        const connection = yield* seedConnection(post.organizationId, "github");
        return {
          connectionId: connection,
          idempotencyKey: `create-issue-${suffix}`,
          organizationId: post.organizationId,
          postId: post.postId,
        };
      });

    it.effect("lets exactly one caller re-claim a failed reservation", () =>
      Effect.gen(function* () {
        const service = yield* ExternalResourceService;
        const input = yield* reservationRace("failed-race");

        const held = yield* service.reserveCreation(input);
        expect(held.reserved).toBe(true);
        if (!held.reserved) {
          return yield* Effect.die("Expected the reservation to be taken");
        }
        yield* service.failCreation({
          requestId: held.id,
          reservedAt: held.reservedAt,
        });

        const raced = yield* Effect.all(
          [service.reserveCreation(input), service.reserveCreation(input)],
          { concurrency: "unbounded" }
        );

        expect(raced.filter((result) => result.reserved)).toHaveLength(1);
      })
    );

    it.effect("lets exactly one caller take a stale reservation", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const service = yield* ExternalResourceService;
        const input = yield* reservationRace("stale-race");

        const held = yield* service.reserveCreation(input);
        expect(held.reserved).toBe(true);
        // Push the reservation past its lease, which is the only thing making
        // a `pending` row re-claimable.
        const now = yield* DateTime.nowAsDate;
        yield* db
          .update(schema.externalResourceCreateRequestTable)
          .set({
            createdAt: DateTime.toDateUtc(
              DateTime.subtractDuration(
                DateTime.fromDateUnsafe(now),
                Duration.hours(2)
              )
            ),
          })
          .where(eq(schema.externalResourceCreateRequestTable.id, held.id));

        const raced = yield* Effect.all(
          [service.reserveCreation(input), service.reserveCreation(input)],
          { concurrency: "unbounded" }
        );

        expect(raced.filter((result) => result.reserved)).toHaveLength(1);
      })
    );

    /**
     * The lease exists so a stalled holder can be taken over, and taking it over
     * is only safe if the stalled holder can no longer write to the row. A
     * re-claim leaves the row `pending`, so the source-state check alone still
     * matches it; the claim instant is what fences the old holder out.
     */
    it.effect(
      "does not let an expired claim end a re-claimed reservation",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const service = yield* ExternalResourceService;
          const post = yield* seedPost("claim-fence");
          const connection = yield* seedConnection(
            post.organizationId,
            "github"
          );
          const input = {
            connectionId: connection,
            idempotencyKey: "create-issue-claim-fence",
            organizationId: post.organizationId,
            postId: post.postId,
          };

          const expired = yield* service.reserveCreation(input);
          if (!expired.reserved) {
            return yield* Effect.die(
              "Expected the first reservation to be taken"
            );
          }

          // Let the lease lapse, then let a second caller take it over. The clock
          // is advanced rather than the row's `createdAt` rewound: the fence
          // relies on that stamp only ever moving forward.
          yield* TestClock.adjust("2 hours");
          const current = yield* service.reserveCreation(input);
          if (!current.reserved) {
            return yield* Effect.die(
              "Expected the reservation to be re-claimed"
            );
          }

          expect(current.id).toBe(expired.id);
          expect(current.reservedAt).not.toStrictEqual(expired.reservedAt);

          const recorded = yield* service.recordPostLink({
            postId: post.postId,
            resource: resource(post.organizationId, connection),
          });

          // The expired holder can neither complete nor release the row.
          expect(
            yield* service.completeCreation({
              externalResourceId: recorded.externalResourceId,
              postExternalResourceLinkId: recorded.postExternalResourceLinkId,
              requestId: expired.id,
              reservedAt: expired.reservedAt,
            })
          ).toBe(false);
          expect(
            yield* service.failCreation({
              requestId: expired.id,
              reservedAt: expired.reservedAt,
            })
          ).toBe(false);

          const [afterExpired] = yield* db
            .select({
              postExternalResourceLinkId:
                schema.externalResourceCreateRequestTable
                  .postExternalResourceLinkId,
              state: schema.externalResourceCreateRequestTable.state,
            })
            .from(schema.externalResourceCreateRequestTable)
            .where(
              eq(schema.externalResourceCreateRequestTable.id, expired.id)
            );
          expect(afterExpired?.state).toBe("pending");
          expect(afterExpired?.postExternalResourceLinkId).toBeNull();

          // The holder that owns the row still can.
          expect(
            yield* service.completeCreation({
              externalResourceId: recorded.externalResourceId,
              postExternalResourceLinkId: recorded.postExternalResourceLinkId,
              requestId: current.id,
              reservedAt: current.reservedAt,
            })
          ).toBe(true);
        })
    );

    it.effect("rejects a provider URL that is not http(s) at write time", () =>
      Effect.gen(function* () {
        const service = yield* ExternalResourceService;
        const post = yield* seedPost("non-http");
        const connection = yield* seedConnection(post.organizationId, "github");

        const exit = yield* Effect.exit(
          service.recordPostLink({
            postId: post.postId,
            resource: {
              ...resource(post.organizationId, connection),
              remoteUrl: new URL("javascript:alert(1)"),
            },
          })
        );

        expect(Exit.isFailure(exit)).toBe(true);
      })
    );
  });
});
