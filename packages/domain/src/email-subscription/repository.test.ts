import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Layer from "effect/Layer";
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
    it.effect("stores only token hashes for a double-opt-in changelog subscription", () =>
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

        if (Option.isNone(created.verificationToken)) {
          return;
        }
        const verificationToken = Redacted.value(created.verificationToken.value);
        const unsubscribeToken = Redacted.value(created.unsubscribeToken);
        const [stored] = yield* db
          .select({
            unsubscribeTokenHash: schema.emailSubscriptionTable.unsubscribeTokenHash,
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

    it.effect("activates once after verification and keeps verification idempotent", () =>
      Effect.gen(function* () {
        const organizationId = yield* WorkspaceId.generate;
        const repository = yield* EmailSubscriptionRepository;

        yield* createOrganization(organizationId);
        const created = yield* repository.requestSubscription(
          pendingChangelogSubscription(organizationId)
        );
        if (Option.isNone(created.verificationToken)) {
          return;
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
        ).toEqual({ _tag: "AlreadyVerified" });
        const subscription = yield* repository.findSubscription({
            email: "subscriber@example.com",
            organizationId,
            topic: { topicId: null, topicType: "changelog" },
          });
        expect(Option.getOrUndefined(subscription)).toMatchObject({ state: "active" });
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
          return;
        }

        expect(
          yield* repository.verifySubscription({
            now: new Date("2026-08-09T00:16:00.000Z"),
            verificationToken: Redacted.value(created.verificationToken.value),
          })
        ).toEqual({ _tag: "Expired" });
      })
    );

    it.effect("unsubscribes one topic idempotently without affecting another", () =>
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
        const token = Redacted.value(changelog.unsubscribeToken);

        expect(post.contact.id).toBe(changelog.contact.id);
        expect(yield* repository.unsubscribe({ now: new Date("2026-08-09T00:01:00.000Z"), unsubscribeToken: token })).toEqual({
          _tag: "Unsubscribed",
        });
        expect(yield* repository.unsubscribe({ now: new Date("2026-08-09T00:02:00.000Z"), unsubscribeToken: token })).toEqual({
          _tag: "AlreadyUnsubscribed",
        });
        expect(changelog.subscription.state).toBe("active");
        expect(post.subscription.state).toBe("active");
        const changelogState = yield* repository.findSubscription({
            email: "subscriber@example.com",
            organizationId,
            topic: { topicId: null, topicType: "changelog" },
          });
        expect(Option.getOrUndefined(changelogState)).toMatchObject({ state: "unsubscribed" });
        const postState = yield* repository.findSubscription({
            email: "subscriber@example.com",
            organizationId,
            topic: { topicId: "pst_1", topicType: "post" },
          });
        expect(Option.getOrUndefined(postState)).toMatchObject({ state: "active" });
      })
    );

    it.effect("unsubscribes an authenticated user from only their exact post topic idempotently", () =>
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

        const first = yield* repository.unsubscribeAuthenticatedPostSubscription({
          now: new Date("2026-08-09T00:01:00.000Z"),
          organizationId,
          postId: "post_a",
          userId: "usr_post_subscriber",
        });
        expect(first).toEqual({ _tag: "Unsubscribed" });
        const second = yield* repository.unsubscribeAuthenticatedPostSubscription({
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
        expect(Option.getOrUndefined(postA)).toMatchObject({ state: "unsubscribed" });
        expect(Option.getOrUndefined(postB)).toMatchObject({ state: "active" });
      })
    );

    it.effect("reconciles only active and plan-paused subscription states", () =>
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

        expect(yield* repository.reconcileSubscriptionPlanStates({
          eligible: false,
          organizationId,
        })).toEqual({ paused: 1, resumed: 0 });
        expect(yield* repository.reconcileSubscriptionPlanStates({
          eligible: true,
          organizationId,
        })).toEqual({ paused: 0, resumed: 1 });
        const active = yield* repository.findSubscription({
          email: "usr_plan_state@example.com", organizationId,
          topic: { topicId: "post_active", topicType: "post" },
        });
        const pending = yield* repository.findSubscription({
          email: "pending-plan-state@example.com", organizationId,
          topic: { topicId: "post_pending", topicType: "post" },
        });
        expect(Option.getOrUndefined(active)).toMatchObject({ state: "active" });
        expect(Option.getOrUndefined(pending)).toMatchObject({ state: "pending_verification" });
      })
    );

    it.effect("suppresses normalized addresses idempotently by provider event", () =>
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
  });
});
