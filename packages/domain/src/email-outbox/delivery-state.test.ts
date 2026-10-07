import { NodeCrypto } from "@effect/platform-node";
import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  canTransitionDelivery,
  isTerminalDeliveryState,
} from "./delivery-state";
import { EmailOutboxRepository } from "./repository";

const deterministicMessageIdPattern =
  /^<email\.[a-f0-9]{64}@notifications\.feeblo\.com>$/;

describe("email delivery state", () => {
  const TestLayer = EmailOutboxRepository.layer.pipe(
    // The repository's deterministic message id hashes through the Crypto
    // service now, so the fixture supplies the node implementation.
    Layer.provideMerge(NodeCrypto.layer),
    Layer.provideMerge(Database.PgliteDatabaseLive)
  );

  layer(TestLayer)("repository", (it) => {
    it("allows only valid lifecycle transitions", () => {
      expect(canTransitionDelivery("queued", "sending")).toBe(true);
      expect(canTransitionDelivery("queued", "failed")).toBe(true);
      expect(canTransitionDelivery("deferred", "failed")).toBe(true);
      expect(canTransitionDelivery("sending", "expired")).toBe(true);
      expect(canTransitionDelivery("sending", "paused_by_plan")).toBe(true);
      expect(canTransitionDelivery("delivered", "sending")).toBe(false);
      expect(isTerminalDeliveryState("delivered")).toBe(true);
      expect(isTerminalDeliveryState("deferred")).toBe(false);
    });

    it.effect(
      "creates one normalized recipient delivery and lets one claimant send it",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const repository = yield* EmailOutboxRepository;
          const organizationId = yield* WorkspaceId.generate;

          yield* db.insert(schema.organizationTable).values({
            id: organizationId,
            name: "Delivery state workspace",
            slug: organizationId,
            createdAt: yield* DateTime.nowAsDate,
          });
          const intent = yield* repository.recordIntent({
            aggregateId: "pst_delivery",
            aggregateType: "post",
            deduplicationKey: `submission.created:${organizationId}:pst_delivery`,
            expiresAt: null,
            kind: "submission.created",
            organizationId,
            payload: { kind: "submission.created", postId: "pst_delivery" },
            scheduledAt: yield* DateTime.nowAsDate,
          });
          if (intent._tag !== "Inserted") {
            expect(intent).toEqual({ _tag: "Inserted" });
            return;
          }

          const created = yield* repository.createDelivery({
            outboxId: intent.intent.id,
            recipientEmail: " Admin@Example.com ",
            template: "submission-notification",
            templatePayload: { postId: "pst_delivery" },
            templateVersion: 1,
          });
          const duplicate = yield* repository.createDelivery({
            outboxId: intent.intent.id,
            recipientEmail: "admin@example.com",
            template: "submission-notification",
            templatePayload: { postId: "pst_delivery" },
            templateVersion: 1,
          });

          expect(created._tag).toBe("Inserted");
          expect(duplicate).toEqual({ _tag: "Duplicate" });
          if (created._tag !== "Inserted") {
            expect(created).toEqual({ _tag: "Inserted" });
            return;
          }
          expect(created.delivery.recipientEmail).toBe("admin@example.com");
          expect(created.delivery.messageId).toMatch(
            deterministicMessageIdPattern
          );

          const claims = yield* Effect.all(
            [
              repository.claimDeliveryForSending({
                id: created.delivery.id,
                now: yield* DateTime.nowAsDate,
              }),
              repository.claimDeliveryForSending({
                id: created.delivery.id,
                now: yield* DateTime.nowAsDate,
              }),
            ],
            { concurrency: "unbounded" }
          );

          expect(
            claims.filter((claimed) => claimed !== undefined)
          ).toHaveLength(1);
        })
    );

    it.effect("refuses a deferral from a stale attempt that lost the row", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const repository = yield* EmailOutboxRepository;
        const organizationId = yield* WorkspaceId.generate;

        yield* db.insert(schema.organizationTable).values({
          id: organizationId,
          name: "Stale deferral workspace",
          slug: organizationId,
          createdAt: yield* DateTime.nowAsDate,
        });
        const intent = yield* repository.recordIntent({
          aggregateId: "pst_stale",
          aggregateType: "post",
          deduplicationKey: `submission.created:${organizationId}:pst_stale`,
          expiresAt: null,
          kind: "submission.created",
          organizationId,
          payload: { kind: "submission.created", postId: "pst_stale" },
          scheduledAt: yield* DateTime.nowAsDate,
        });
        if (intent._tag !== "Inserted") {
          expect(intent).toEqual({ _tag: "Inserted" });
          return;
        }
        const created = yield* repository.createDelivery({
          outboxId: intent.intent.id,
          recipientEmail: "stale@example.com",
          template: "submission-notification",
          templatePayload: { postId: "pst_stale" },
          templateVersion: 1,
        });
        if (created._tag !== "Inserted") {
          expect(created).toEqual({ _tag: "Inserted" });
          return;
        }

        // A pre-claim deferral is valid against the version just read.
        const preClaimDeferred = yield* repository.deferSendingDelivery({
          id: created.delivery.id,
          expectedTransitionVersion: created.delivery.transitionVersion,
          nextAttemptAt: yield* DateTime.nowAsDate,
          lastError: { tag: "EmailDeliveryActivityError" },
        });
        expect(preClaimDeferred).toBe(true);

        const claimedVersion = yield* repository.claimDeliveryForSending({
          id: created.delivery.id,
          now: yield* DateTime.nowAsDate,
        });
        if (claimedVersion === undefined) {
          return yield* Effect.die("Expected the claim to win");
        }

        // The pre-claim version is now stale; the deferral must not clobber
        // the claim it no longer owns.
        const staleDeferred = yield* repository.deferSendingDelivery({
          id: created.delivery.id,
          expectedTransitionVersion: created.delivery.transitionVersion,
          nextAttemptAt: yield* DateTime.nowAsDate,
          lastError: { tag: "EmailDeliveryActivityError" },
        });
        expect(staleDeferred).toBe(false);
        const afterStale = yield* repository.findDeliveryById(
          created.delivery.id
        );
        expect(afterStale?.state).toBe("sending");
        expect(afterStale?.transitionVersion).toBe(claimedVersion);

        // The claim holder can still defer against the version it wrote.
        const claimedDeferred = yield* repository.deferSendingDelivery({
          id: created.delivery.id,
          expectedTransitionVersion: claimedVersion,
          nextAttemptAt: yield* DateTime.nowAsDate,
          lastError: { tag: "EmailDeliveryActivityError" },
        });
        expect(claimedDeferred).toBe(true);
        const afterClaimed = yield* repository.findDeliveryById(
          created.delivery.id
        );
        expect(afterClaimed?.state).toBe("deferred");
        expect(afterClaimed?.transitionVersion).toBe(claimedVersion + 1);
      })
    );

    it.effect("does not revive a terminal delivery when work is replayed", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const repository = yield* EmailOutboxRepository;
        const organizationId = yield* WorkspaceId.generate;

        yield* db.insert(schema.organizationTable).values({
          id: organizationId,
          name: "Terminal delivery workspace",
          slug: organizationId,
          createdAt: yield* DateTime.nowAsDate,
        });
        const intent = yield* repository.recordIntent({
          aggregateId: "pst_terminal",
          aggregateType: "post",
          deduplicationKey: `submission.created:${organizationId}:pst_terminal`,
          expiresAt: null,
          kind: "submission.created",
          organizationId,
          payload: { kind: "submission.created", postId: "pst_terminal" },
          scheduledAt: yield* DateTime.nowAsDate,
        });
        if (intent._tag !== "Inserted") {
          expect(intent).toEqual({ _tag: "Inserted" });
          return;
        }
        const delivery = yield* repository.createDelivery({
          outboxId: intent.intent.id,
          recipientEmail: "terminal@example.com",
          template: "submission-notification",
          templatePayload: { postId: "pst_terminal" },
          templateVersion: 1,
        });
        if (delivery._tag !== "Inserted") {
          expect(delivery).toEqual({ _tag: "Inserted" });
          return;
        }

        yield* repository.claimDeliveryForSending({
          id: delivery.delivery.id,
          now: yield* DateTime.nowAsDate,
        });
        const firstDelivery = yield* repository.markDeliveryDelivered({
          id: delivery.delivery.id,
          deliveredAt: yield* DateTime.nowAsDate,
        });
        const repeatedDelivery = yield* repository.markDeliveryDelivered({
          id: delivery.delivery.id,
          deliveredAt: yield* DateTime.nowAsDate,
        });
        const replayClaim = yield* repository.claimDeliveryForSending({
          id: delivery.delivery.id,
          now: yield* DateTime.nowAsDate,
        });

        expect(firstDelivery).toBe(true);
        expect(repeatedDelivery).toBe(false);
        expect(replayClaim).toBeUndefined();
      })
    );
  });
});
