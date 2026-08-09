import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { EmailSubscriptionRepository } from "./repository";

describe("EmailSubscriptionRepository", () => {
  const TestLayer = EmailSubscriptionRepository.layer.pipe(
    Layer.provideMerge(Database.PgliteDatabaseLive)
  );

  const createOrganization = (id: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      yield* db.insert(schema.organizationTable).values({
        id,
        name: "Email subscription test workspace",
        slug: id,
        createdAt: new Date(),
      });
    });

  const pendingChangelogSubscription = (organizationId: string) => ({
    email: "  Subscriber@Example.com ",
    now: new Date("2026-08-09T00:00:00.000Z"),
    organizationId,
    source: "explicit" as const,
    topic: { topicId: null, topicType: "changelog" as const },
    verificationExpiresAt: new Date("2026-08-09T00:15:00.000Z"),
  });

  const createVerifiedUser = (id: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const now = new Date("2026-08-09T00:00:00.000Z");
      yield* db.insert(schema.userTable).values({
        id,
        name: "Subscription test user",
        email: `${id}@example.com`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
    });

  layer(TestLayer)("repository", (it) => {
    it.effect(
      "stores only token hashes for a double-opt-in changelog subscription",
      () =>
        Effect.gen(function* () {
          const organizationId = yield* WorkspaceId.generate;
          const repository = yield* EmailSubscriptionRepository;
          const db = yield* currentDb;

          yield* createOrganization(organizationId);
          const created = yield* repository.requestSubscription(
            pendingChangelogSubscription(organizationId)
          );
          expect(created.contact.email).toBe("subscriber@example.com");
          expect(created.subscription.state).toBe("pending_verification");
          expect(Option.isSome(created.verificationToken)).toBe(true);
          expect(Option.isSome(created.unsubscribeToken)).toBe(true);

          if (
            Option.isNone(created.verificationToken) ||
            Option.isNone(created.unsubscribeToken)
          ) {
            return expect.fail(
              "A new subscription must issue both link tokens"
            );
          }
          const verificationToken = Redacted.value(
            created.verificationToken.value
          );
          const unsubscribeToken = Redacted.value(
            created.unsubscribeToken.value
          );
          const [stored] = yield* db
            .select({
              unsubscribeTokenHash:
                schema.emailSubscriptionTable.unsubscribeTokenHash,
              verificationTokenHash:
                schema.emailSubscriptionTable.verificationTokenHash,
            })
            .from(schema.emailSubscriptionTable);

          expect(stored?.verificationTokenHash).not.toBe(verificationToken);
          expect(stored?.unsubscribeTokenHash).not.toBe(unsubscribeToken);
          expect(stored?.verificationTokenHash).toHaveLength(64);
          expect(stored?.unsubscribeTokenHash).toHaveLength(64);
          expect(
            yield* repository.verifySubscription({
              now: new Date("2026-08-09T00:01:00.000Z"),
              verificationToken: unsubscribeToken,
            })
          ).toEqual({ _tag: "Invalid" });
          expect(
            yield* repository.unsubscribe({
              now: new Date("2026-08-09T00:01:00.000Z"),
              unsubscribeToken: verificationToken,
            })
          ).toEqual({ _tag: "Invalid" });
        })
    );

    it.effect(
      "activates once after verification and keeps verification idempotent",
      () =>
        Effect.gen(function* () {
          const organizationId = yield* WorkspaceId.generate;
          const repository = yield* EmailSubscriptionRepository;

          yield* createOrganization(organizationId);
          const created = yield* repository.requestSubscription(
            pendingChangelogSubscription(organizationId)
          );
          if (Option.isNone(created.verificationToken)) {
            return expect.fail(
              "A pending subscription must issue a verification token"
            );
          }
          const token = Redacted.value(created.verificationToken.value);

          expect(
            yield* repository.verifySubscription({
              now: new Date("2026-08-09T00:05:00.000Z"),
              verificationToken: token,
            })
          ).toEqual({ _tag: "Verified" });
          expect(
            yield* repository.verifySubscription({
              now: new Date("2026-08-09T00:06:00.000Z"),
              verificationToken: token,
            })
          ).toEqual({ _tag: "Invalid" });
          const subscription = yield* repository.findSubscription({
            email: "subscriber@example.com",
            organizationId,
            topic: { topicId: null, topicType: "changelog" },
          });
          expect(Option.getOrUndefined(subscription)).toMatchObject({
            state: "active",
          });
        })
    );

    it.effect(
      "keeps existing unsubscribe links valid when a subscription is requested again",
      () =>
        Effect.gen(function* () {
          const organizationId = yield* WorkspaceId.generate;
          const repository = yield* EmailSubscriptionRepository;

          yield* createOrganization(organizationId);
          const first = yield* repository.requestSubscription(
            pendingChangelogSubscription(organizationId)
          );
          expect(Option.isSome(first.unsubscribeToken)).toBe(true);
          if (Option.isNone(first.unsubscribeToken)) {
            return expect.fail(
              "A new subscription must issue an unsubscribe token"
            );
          }
          const unsubscribeToken = Redacted.value(first.unsubscribeToken.value);

          const repeated = yield* repository.requestSubscription({
            ...pendingChangelogSubscription(organizationId),
            now: new Date("2026-08-09T00:01:00.000Z"),
          });

          expect(Option.isNone(repeated.unsubscribeToken)).toBe(true);
          expect(
            yield* repository.unsubscribe({
              now: new Date("2026-08-09T00:02:00.000Z"),
              unsubscribeToken,
            })
          ).toEqual({ _tag: "Unsubscribed" });
        })
    );

    it.effect("does not verify an expired token", () =>
      Effect.gen(function* () {
        const organizationId = yield* WorkspaceId.generate;
        const repository = yield* EmailSubscriptionRepository;

        yield* createOrganization(organizationId);
        const created = yield* repository.requestSubscription(
          pendingChangelogSubscription(organizationId)
        );
        if (Option.isNone(created.verificationToken)) {
          return expect.fail(
            "A pending subscription must issue a verification token"
          );
        }

        expect(
          yield* repository.verifySubscription({
            now: new Date("2026-08-09T00:16:00.000Z"),
            verificationToken: Redacted.value(created.verificationToken.value),
          })
        ).toEqual({ _tag: "Expired" });
      })
    );

    it.effect(
      "unsubscribes one topic idempotently without affecting another",
      () =>
        Effect.gen(function* () {
          const organizationId = yield* WorkspaceId.generate;
          const repository = yield* EmailSubscriptionRepository;

          yield* createOrganization(organizationId);
          yield* createVerifiedUser("usr_subscriber");
          const changelog = yield* repository.requestSubscription({
            ...pendingChangelogSubscription(organizationId),
            alreadyVerifiedUser: { userId: "usr_subscriber" },
            email: "subscriber@example.com",
            userId: "usr_subscriber",
          });
          const post = yield* repository.requestSubscription({
            ...pendingChangelogSubscription(organizationId),
            alreadyVerifiedUser: { userId: "usr_subscriber" },
            email: "subscriber@example.com",
            topic: { topicId: "pst_1", topicType: "post" },
            userId: "usr_subscriber",
          });
          expect(Option.isSome(changelog.unsubscribeToken)).toBe(true);
          if (Option.isNone(changelog.unsubscribeToken)) {
            return expect.fail(
              "A new subscription must issue an unsubscribe token"
            );
          }
          const token = Redacted.value(changelog.unsubscribeToken.value);

          expect(post.contact.id).toBe(changelog.contact.id);
          expect(
            yield* repository.unsubscribe({
              now: new Date("2026-08-09T00:01:00.000Z"),
              unsubscribeToken: token,
            })
          ).toEqual({
            _tag: "Unsubscribed",
          });
          expect(
            yield* repository.unsubscribe({
              now: new Date("2026-08-09T00:02:00.000Z"),
              unsubscribeToken: token,
            })
          ).toEqual({
            _tag: "AlreadyUnsubscribed",
          });
          expect(changelog.subscription.state).toBe("active");
          expect(post.subscription.state).toBe("active");
          const changelogState = yield* repository.findSubscription({
            email: "subscriber@example.com",
            organizationId,
            topic: { topicId: null, topicType: "changelog" },
          });
          expect(Option.getOrUndefined(changelogState)).toMatchObject({
            state: "unsubscribed",
          });
          const postState = yield* repository.findSubscription({
            email: "subscriber@example.com",
            organizationId,
            topic: { topicId: "pst_1", topicType: "post" },
          });
          expect(Option.getOrUndefined(postState)).toMatchObject({
            state: "active",
          });
        })
    );

    it.effect(
      "unsubscribes an authenticated user from only their exact post topic idempotently",
      () =>
        Effect.gen(function* () {
          const organizationId = yield* WorkspaceId.generate;
          const repository = yield* EmailSubscriptionRepository;

          yield* createOrganization(organizationId);
          yield* createVerifiedUser("usr_post_subscriber");
          yield* repository.requestSubscription({
            ...pendingChangelogSubscription(organizationId),
            alreadyVerifiedUser: { userId: "usr_post_subscriber" },
            email: "usr_post_subscriber@example.com",
            topic: { topicId: "post_a", topicType: "post" },
            userId: "usr_post_subscriber",
          });
          yield* repository.requestSubscription({
            ...pendingChangelogSubscription(organizationId),
            alreadyVerifiedUser: { userId: "usr_post_subscriber" },
            email: "usr_post_subscriber@example.com",
            topic: { topicId: "post_b", topicType: "post" },
            userId: "usr_post_subscriber",
          });

          const first =
            yield* repository.unsubscribeAuthenticatedPostSubscription({
              now: new Date("2026-08-09T00:01:00.000Z"),
              organizationId,
              postId: "post_a",
              userId: "usr_post_subscriber",
            });
          expect(first).toEqual({ _tag: "Unsubscribed" });
          const second =
            yield* repository.unsubscribeAuthenticatedPostSubscription({
              now: new Date("2026-08-09T00:02:00.000Z"),
              organizationId,
              postId: "post_a",
              userId: "usr_post_subscriber",
            });
          expect(second).toEqual({ _tag: "AlreadyUnsubscribed" });
          const postA = yield* repository.findSubscription({
            email: "usr_post_subscriber@example.com",
            organizationId,
            topic: { topicId: "post_a", topicType: "post" },
          });
          const postB = yield* repository.findSubscription({
            email: "usr_post_subscriber@example.com",
            organizationId,
            topic: { topicId: "post_b", topicType: "post" },
          });
          expect(Option.getOrUndefined(postA)).toMatchObject({
            state: "unsubscribed",
          });
          expect(Option.getOrUndefined(postB)).toMatchObject({
            state: "active",
          });
        })
    );

    it.effect(
      "unsubscribes every contact address owned by the user for one post",
      () =>
        Effect.gen(function* () {
          const organizationId = yield* WorkspaceId.generate;
          const repository = yield* EmailSubscriptionRepository;
          const userId = "usr_multi_address";

          yield* createOrganization(organizationId);
          yield* createVerifiedUser(userId);
          yield* Effect.forEach(
            ["first@example.com", "second@example.com"],
            (email) =>
              repository.requestSubscription({
                ...pendingChangelogSubscription(organizationId),
                alreadyVerifiedUser: { userId },
                email,
                topic: { topicId: "post_multi", topicType: "post" },
                userId,
              }),
            { discard: true }
          );

          expect(
            yield* repository.unsubscribeAuthenticatedPostSubscription({
              now: new Date("2026-08-09T00:01:00.000Z"),
              organizationId,
              postId: "post_multi",
              userId,
            })
          ).toEqual({ _tag: "Unsubscribed" });

          const subscriptions = yield* Effect.forEach(
            ["first@example.com", "second@example.com"],
            (email) =>
              repository.findSubscription({
                email,
                organizationId,
                topic: { topicId: "post_multi", topicType: "post" },
              })
          );
          expect(
            subscriptions.map(
              (subscription) => Option.getOrUndefined(subscription)?.state
            )
          ).toEqual(["unsubscribed", "unsubscribed"]);
        })
    );

    it.effect(
      "reconciles only active and plan-paused subscription states",
      () =>
        Effect.gen(function* () {
          const organizationId = yield* WorkspaceId.generate;
          const repository = yield* EmailSubscriptionRepository;

          yield* createOrganization(organizationId);
          yield* createVerifiedUser("usr_plan_state");
          yield* repository.requestSubscription({
            ...pendingChangelogSubscription(organizationId),
            alreadyVerifiedUser: { userId: "usr_plan_state" },
            email: "usr_plan_state@example.com",
            topic: { topicId: "post_active", topicType: "post" },
            userId: "usr_plan_state",
          });
          yield* repository.requestSubscription({
            ...pendingChangelogSubscription(organizationId),
            email: "pending-plan-state@example.com",
            topic: { topicId: "post_pending", topicType: "post" },
          });

          expect(
            yield* repository.reconcileSubscriptionPlanStates({
              eligible: false,
              now: new Date("2026-08-09T00:01:00.000Z"),
              organizationId,
            })
          ).toEqual({ paused: 1, resumed: 0 });
          expect(
            yield* repository.reconcileSubscriptionPlanStates({
              eligible: true,
              now: new Date("2026-08-09T00:02:00.000Z"),
              organizationId,
            })
          ).toEqual({ paused: 0, resumed: 1 });
          const active = yield* repository.findSubscription({
            email: "usr_plan_state@example.com",
            organizationId,
            topic: { topicId: "post_active", topicType: "post" },
          });
          const pending = yield* repository.findSubscription({
            email: "pending-plan-state@example.com",
            organizationId,
            topic: { topicId: "post_pending", topicType: "post" },
          });
          expect(Option.getOrUndefined(active)).toMatchObject({
            state: "active",
          });
          expect(Option.getOrUndefined(pending)).toMatchObject({
            state: "pending_verification",
          });
        })
    );

    it.effect(
      "suppresses normalized addresses idempotently by provider event",
      () =>
        Effect.gen(function* () {
          const organizationId = yield* WorkspaceId.generate;
          const repository = yield* EmailSubscriptionRepository;

          yield* createOrganization(organizationId);
          expect(
            yield* repository.upsertSuppression({
              email: " Subscriber@Example.com ",
              providerEventId: "evt_1",
              reason: "hard_bounce",
            })
          ).toEqual({ _tag: "Upserted" });
          expect(
            yield* repository.upsertSuppression({
              email: "subscriber@example.com",
              providerEventId: "evt_1",
              reason: "hard_bounce",
            })
          ).toEqual({ _tag: "DuplicateEvent" });
          expect(
            yield* repository.isSuppressed({ email: "SUBSCRIBER@example.com" })
          ).toBe(true);
        })
    );

    it.effect(
      "deduplicates concurrent suppression writes by provider event",
      () =>
        Effect.gen(function* () {
          const organizationId = yield* WorkspaceId.generate;
          const repository = yield* EmailSubscriptionRepository;
          const db = yield* currentDb;

          yield* createOrganization(organizationId);
          const results = yield* Effect.all(
            ["first-bounce@example.com", "second-bounce@example.com"].map(
              (email) =>
                repository.upsertSuppression({
                  email,
                  providerEventId: "evt_concurrent",
                  reason: "hard_bounce",
                })
            ),
            { concurrency: "unbounded" }
          );

          expect(results.map((result) => result._tag).sort()).toEqual([
            "DuplicateEvent",
            "Upserted",
          ]);
          expect(
            yield* db
              .select({ email: schema.emailSuppressionTable.email })
              .from(schema.emailSuppressionTable)
              .where(
                eq(
                  schema.emailSuppressionTable.providerEventId,
                  "evt_concurrent"
                )
              )
          ).toHaveLength(1);
        })
    );
  });
});
