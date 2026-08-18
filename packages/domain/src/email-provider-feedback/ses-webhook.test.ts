import * as NodeCrypto from "node:crypto";

import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import { EmailProviderFeedbackConfig } from "./config";
import { EmailProviderFeedbackService } from "./service";
import type { SesSnsEnvelope } from "./ses-schema";
import {
  buildSnsStringToSign,
  SesEmailFeedbackWebhook,
  SesWebhookConfirmationError,
  SesWebhookEnvelopeError,
} from "./ses-webhook";

const TEST_TOPIC_ARN = "arn:aws:sns:us-east-1:123456789012:feeblo-mail-events";
const SIGNING_CERT_URL =
  "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem";
const SIGNING_CERT_CHAIN_URL =
  "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-chain.pem";

// Self-signed fixture signer generated for this suite; the private key signs
// every test envelope and the corresponding certificate (served standalone or
// first in a chain bundle) carries the matching public key.
const SIGNING_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCId9C5LTLvaIt0
gJU5JbjcydQeVIJWW/PExhYFz7SNDZt3QEjfJh92VDXRr0RV4viu/esoUSw8bfoh
toK71We8GfLzOlTr32WGSz7BBSpLJKaV2vzXy1FjIeJeJppAvTKFuq3SpAE9cWnc
sAsf6o36QSGd+XemeGpb2RQ902eudNS7Ig1EtRxI/q5z9wasQimMjoUzthudWAlG
6eyJP3F4T2yApPtozKGggmsoBACpZuvVTVt+OZWiBZy+BVsV227yzUS/7tvXT2eq
pLQ60kJOdWLVqp5I43Zx7Q7E5xTCvhD3D7VLSIitz1mHNSw7gasSSC/LivKqRuwA
tkhn0qYHAgMBAAECggEANpM7/KIvyYCUrK2zf5wvVtS8KLkBOsohLaNOMVrESNiV
QNaLjfowAOFieI3QFUzkyQ6w2XnE6BHPQ2Y62CVbC+WQvGaqiX3YmyFCYmzPYiex
GyLtlNsxnCRz49UqQROovcRPOXrvKARQIrqgaE4kI12itQuMJx3m4v5oUuVVhHWN
CEmCd+ZEBqv5TK3RtccesyubuEMHxq94vrgmlY23CJA4rxRxEWchtX5ymMKHolO+
GBnlWw6NN/DGvWF5SJ6C94D2AdwrPKs1RaVPiInImXTDYm/k43WESLxHYua705Rg
JZsMGXePS9RgF5OOVsVHcxO7cOBRRQ4hEFFHTFKuCQKBgQC/L9WiZDOCRxasxB3X
uaXZ7EPtnzwyFKUHHxVVW8qATdsFvp54JXcZ8qTP9ofLXjiN0UINzruV/AXDH7fx
Xc1OrabXeLAYnzlonwDXm1O1zw/9fTsP9pmkSCp0Q+8SnolLlG+c72EWcWu+JrND
sh8fQS9PdrQ8tPp8juy2qCkfNQKBgQC2uzQWtItytn2HpMfNjvt7c2B0AezO/4Kn
h5LmdGBvHeaaKXunkiMvvqoZwCPqJxOFjAT/tf+SywdQz7H73IePtX0IEVr69u5y
m5l/IPEVMYFhuD5panWVHOkEuZ6yHLPexYLTDXapYVLgMMHFHbNShq9/erXP27uX
AkHVDTUrywKBgFWCj4qSRnd+VCXxkWdrIULW6YreLY44rZcB0AjdhTTdnZh0KWyT
VTHF1PEu0o2jFqhXb7O9QylSD0G2bg8GZU1LXdQBpsFcddDVTQsh7c7jTcOSv1fk
c9OGc3aM6+DoB4BGY6VNa58eG5JwvL0KbeEMxpxD+1krmN0dD8Kic8IBAoGAM6vU
GueK1zFLZePuq+3Wpx4FFEjHEfGmnID1xTz7V/B4mPdKBCSK1qFvsEBo53mNR6JE
d5qbXoMS2oMgrTu7CaQkavedZoIVA0uEqDJEed253EwhOeXkwfme2rsyaOM86a2o
RM311Ae1S7f90yOG5bs4PTAR4WkdLqJwwzIs6ukCgYB5q1J82NMUwhQSU4aRlK1m
F0QYQjo+KCSK1sQG5XSWUul3VhVQ3BALyHFyKe9w+MbyYI8pGjX1ExEgXNeIwLp4
+mydNoooVwcqRfmKpMtJN/E/UkESeHLExMCGlV7RVKyv494P39AstL0+WY4m3YN1
bbPZbVKNOtjP5A5PH5g6aA==
-----END PRIVATE KEY-----
`;

const SIGNING_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDLzCCAhegAwIBAgIUUDAUjzHbl7zP7z/IzNa4RQlx/twwDQYJKoZIhvcNAQEL
BQAwJjEkMCIGA1UEAwwbc25zLnVzLWVhc3QtMS5hbWF6b25hd3MuY29tMCAXDTI2
MDgxNzIzMDc0M1oYDzIxMjYwNzI0MjMwNzQzWjAmMSQwIgYDVQQDDBtzbnMudXMt
ZWFzdC0xLmFtYXpvbmF3cy5jb20wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEK
AoIBAQCId9C5LTLvaIt0gJU5JbjcydQeVIJWW/PExhYFz7SNDZt3QEjfJh92VDXR
r0RV4viu/esoUSw8bfohtoK71We8GfLzOlTr32WGSz7BBSpLJKaV2vzXy1FjIeJe
JppAvTKFuq3SpAE9cWncsAsf6o36QSGd+XemeGpb2RQ902eudNS7Ig1EtRxI/q5z
9wasQimMjoUzthudWAlG6eyJP3F4T2yApPtozKGggmsoBACpZuvVTVt+OZWiBZy+
BVsV227yzUS/7tvXT2eqpLQ60kJOdWLVqp5I43Zx7Q7E5xTCvhD3D7VLSIitz1mH
NSw7gasSSC/LivKqRuwAtkhn0qYHAgMBAAGjUzBRMB0GA1UdDgQWBBQqDijOrV98
MH1TEgtWLB2MUq0tQzAfBgNVHSMEGDAWgBQqDijOrV98MH1TEgtWLB2MUq0tQzAP
BgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQB2wWeyY4CNMhrqGnV3
/farzR4cVJdEntiEB2Ndt9QhCi2eBNsojx/8QLqm/LQKn0mvFwjqWL7L7pcnZK8g
SmpryEE6DZABxSqdmEsZhkhp8NppRefNzsWfo5iXTsj9BnpYHpEa3in3sHu8O8WN
f+wKhLwc0Np9sbw3kg+EfD/e8ZM/XPIwWfhF1vQJ9+tug0W9HvkDuuMWA3RBaJ8E
rWMjOebiFhZNbjoL42mCMXIYYF7MjwcSE6dla5j+pcWNIoBj/VRhql9NwvIL2XXN
gvKsasu6K+jSM7S5rTL5/ex2gdbFsMkWJbFSD6L+gn5OEqmaedBRvayGwAliFOmn
bmpX
-----END CERTIFICATE-----
`;

// SNS serves current signing certs as the signer certificate first in a chain
// bundle; the second certificate is a filler that must not be used for
// verification.
const SIGNING_CERT_CHAIN_PEM = `${SIGNING_CERT_PEM}
-----BEGIN CERTIFICATE-----
MIIDLzCCAhegAwIBAgIUYt85AGkBzA1QU2mbtZwk/UxRPmMwDQYJKoZIhvcNAQEL
BQAwJjEkMCIGA1UEAwwbaW50ZXJtZWRpYXRlLWNhLmV4YW1wbGUubmV0MCAXDTI2
MDgxNzIzMDc0M1oYDzIxMjYwNzI0MjMwNzQzWjAmMSQwIgYDVQQDDBtpbnRlcm1l
ZGlhdGUtY2EuZXhhbXBsZS5uZXQwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEK
AoIBAQC9H5/RA8nyfdzn3bvsdrOnEcluAir3Au1W8DN6rteM4C3KU/Nhm7qJn4Nx
lWN42Bt+tJy/0bzG378akUGrk07LdZqXo9+kji0Dio/DRI+SblRzy9B3n0dNdRC+
RHvQ9YpgqKErgAKX6Yl6OFTdEFShg0a/wwiFfyIfg+kgRJT6IWCQfTSoN/v7kziB
sAtMm2kc5o5LdDRhUnEQBsSL1MctZ1mbowffrtTgA3E179oJtJLYW+gGvX6NWBNk
4GkkvZQC2eYsxF/0DWO4FLOo7ZPQtxMXi2lgi3m+x4iE/nWSwyXALlo5sIEun2oj
VY5vfAdWLVV6JEHWBtRkjeyYQlSTAgMBAAGjUzBRMB0GA1UdDgQWBBQk4IARQp9F
GpU6ysKLngpAhhlsYzAfBgNVHSMEGDAWgBQk4IARQp9FGpU6ysKLngpAhhlsYzAP
BgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQB2P8P+jdno47NY92lQ
hrZPlWCsXcbEUS8MZqMw7EtajYC61+1DG6dM0Uy0K04kgBbVJmt/T9N5EHbFX2Lt
Jwev4ZQySAuMJC/4JLY5/CdJpIzJBlHq1EKmfMxBImQiORWxgKfc2DiLXCNsPozR
MrrhUZTArQf7hE+B0I5Pc6rAYXDk4LC6G+zbHASkXpPt3qSsj14rltBgXez2ViyR
+djOfSAlFI6eX2+i77X7pvtH4LOkX75TgyqL5kwkqL0VOJy/wDspY/v3jYeEGhpJ
y8cMlA6NLYSX7aTAJVQg9IRasVO6cUgrrsPqJ0xMjhNwBvI0yMHkvwa93J3EtIme
QfCj
-----END CERTIFICATE-----
`;

const TEST_SIGNING_KEY = NodeCrypto.createPrivateKey(SIGNING_KEY_PEM);

const parseJsonObject = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json))
);
const stringifyJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json));

type TestEnvelope = { readonly Type: string } & Record<string, string>;

const signEnvelope = (
  envelope: TestEnvelope,
  signatureVersion: "1" | "2" = "1"
): string => {
  const algorithm = signatureVersion === "2" ? "sha256" : "sha1";
  const Signature = NodeCrypto.sign(
    algorithm,
    Buffer.from(
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- TS rejects a single cast (TS2352) from the loose fixture envelope, so signing needs the two-step cast to satisfy the SNS envelope contract.
      buildSnsStringToSign({
        ...envelope,
        SignatureVersion: signatureVersion,
      } as unknown as SesSnsEnvelope),
      "utf8"
    ),
    TEST_SIGNING_KEY
  ).toString("base64");
  return stringifyJson({
    ...envelope,
    Signature,
    SignatureVersion: signatureVersion,
  });
};

const snsNotification = (
  messageId: string,
  message: Schema.Json,
  signatureVersion: "1" | "2" = "1"
): string =>
  signEnvelope(
    {
      Type: "Notification",
      MessageId: messageId,
      TopicArn: TEST_TOPIC_ARN,
      Message: stringifyJson(message),
      Timestamp: "2026-08-18T00:00:02.000Z",
      SignatureVersion: signatureVersion,
      SigningCertURL: SIGNING_CERT_URL,
    },
    signatureVersion
  );

const snsSubscriptionConfirmation = (subscribeUrl: string): string =>
  signEnvelope({
    Type: "SubscriptionConfirmation",
    MessageId: "sns-confirm-1",
    Token: "2336412f37fb687f5d51e6e2425b0044",
    TopicArn: TEST_TOPIC_ARN,
    Message: "You have chosen to subscribe to the topic",
    SubscribeURL: subscribeUrl,
    Timestamp: "2026-08-18T00:00:00.000Z",
    SignatureVersion: "1",
    SigningCertURL: SIGNING_CERT_URL,
  });

/**
 * Asserts that the effect failed, filters the failure cause down to its fail
 * reasons and returns the first error so callers can assert its type.
 */
const expectFailed = <E>(exit: Exit.Exit<unknown, E>): E => {
  if (Exit.isFailure(exit)) {
    const failures = exit.cause.reasons
      .filter(Cause.isFailReason)
      .map((reason) => reason.error);
    const [error] = failures;
    expect(error).toBeDefined();
    // SAFETY: Exit fail-reason errors conform to the caller's expected type E.
    return error as E;
  }
  throw new Error("expected the effect to fail, but it exited successfully");
};

// SAFETY: these stubs implement the subset of `fetch` the webhook's HttpClient
// exercises; the extra variance in real `fetch` overloads is irrelevant, and
// this is the single noted cast at the test boundary.
const asFetch = (
  impl: (input: RequestInfo | URL) => Promise<Response>
): typeof fetch => impl as typeof fetch;

const fetchStub = asFetch((input: RequestInfo | URL): Promise<Response> => {
  const url = String(input);
  if (url === SIGNING_CERT_URL) {
    return Promise.resolve(new Response(SIGNING_CERT_PEM, { status: 200 }));
  }
  if (url === SIGNING_CERT_CHAIN_URL) {
    return Promise.resolve(
      new Response(SIGNING_CERT_CHAIN_PEM, { status: 200 })
    );
  }
  return Promise.resolve(new Response("Not Found", { status: 404 }));
});

// Shared by the subscription-confirmation test so the captured HttpClient
// records the signing-certificate fetch and the confirmation GET. Built
// before makeWebhookLayer so it is wired through the fetchImpl argument.
const subscriptionConfirmationRequests: string[] = [];
const SubscriptionConfirmationFetch = asFetch(
  (input: RequestInfo | URL): Promise<Response> => {
    subscriptionConfirmationRequests.push(String(input));
    return String(input) === SIGNING_CERT_URL
      ? Promise.resolve(new Response(SIGNING_CERT_PEM, { status: 200 }))
      : Promise.resolve(
          new Response("Subscription Confirmed", { status: 200 })
        );
  }
);

const TestConfig = Layer.succeed(
  EmailProviderFeedbackConfig,
  EmailProviderFeedbackConfig.of({
    webhookToken: Option.some(Redacted.make("test-webhook-token")),
    expectedTopicArn: Option.some(TEST_TOPIC_ARN),
  })
);

const NoTopicArnConfig = Layer.succeed(
  EmailProviderFeedbackConfig,
  EmailProviderFeedbackConfig.of({
    webhookToken: Option.some(Redacted.make("test-webhook-token")),
    expectedTopicArn: Option.none(),
  })
);

// Builds a fresh webhook service (and therefore a fresh signing-certificate
// cache) for every call; layers built here must not reuse the memoized
// SesEmailFeedbackWebhook.layer static or tests would share the cache.
const makeWebhookLayer = (
  config: Layer.Layer<EmailProviderFeedbackConfig>,
  fetchImpl: typeof fetch
) =>
  Layer.effect(SesEmailFeedbackWebhook, SesEmailFeedbackWebhook.make).pipe(
    Layer.provideMerge(EmailProviderFeedbackService.layer),
    Layer.provideMerge(config),
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.provideMerge(Layer.succeed(FetchHttpClient.Fetch, fetchImpl)),
    Layer.provideMerge(Database.PgliteDatabaseLive)
  );

const TestLayer = makeWebhookLayer(TestConfig, fetchStub);

const NoTopicArnLayer = makeWebhookLayer(NoTopicArnConfig, fetchStub);

describe("SesEmailFeedbackWebhook", () => {
  const makeDelivery = (recipientEmail = "feedback@example.com") =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const now = new Date();
      const outboxId = `eob_${organizationId}`;
      const deliveryId = `edl_${organizationId}`;
      const messageId = `<email.${organizationId}@notifications.feeblo>`;

      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "Provider feedback workspace",
        slug: organizationId,
        createdAt: now,
      });
      yield* db.insert(schema.emailOutboxTable).values({
        id: outboxId,
        organizationId,
        kind: "submission.created",
        aggregateType: "post",
        aggregateId: "pst_feedback",
        deduplicationKey: `submission.created:${organizationId}`,
        payload: { kind: "submission.created", postId: "pst_feedback" },
        scheduledAt: now,
        expiresAt: null,
        state: "materialized",
      });
      yield* db.insert(schema.emailDeliveryTable).values({
        id: deliveryId,
        outboxId,
        contactId: null,
        recipientEmail,
        template: "submission-notification",
        templateVersion: 1,
        templatePayload: { postId: "pst_feedback" },
        messageId,
        state: "accepted",
        attemptCount: 1,
        nextAttemptAt: null,
        acceptedAt: now,
        deliveredAt: null,
        lastError: null,
        providerMetadata: null,
      });

      return { deliveryId, messageId, outboxId };
    });

  layer(TestLayer)("webhook", (it) => {
    it.effect(
      "ingests an SES delivery notification and correlates it to the delivery",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const webhook = yield* SesEmailFeedbackWebhook;
          const delivery = yield* makeDelivery();

          const outcome = yield* webhook.handle(
            snsNotification("sns-delivery-1", {
              eventType: "Delivery",
              mail: {
                timestamp: "2026-08-18T00:00:00.000Z",
                messageId: "01000178a3125d21-000000",
                source: "noreply@feeblo.com",
                destination: ["feedback@example.com"],
                headers: [{ name: "Message-ID", value: delivery.messageId }],
                commonHeaders: { messageId: delivery.messageId },
              },
              delivery: {
                timestamp: "2026-08-18T00:00:02.000Z",
                smtpResponse: "250 2.6.0 Message received",
                recipients: ["feedback@example.com"],
              },
            })
          );

          expect(outcome).toMatchObject({
            _tag: "Ingested",
            result: { _tag: "Processed", deliveryUpdated: true },
          });
          const [stored] = yield* db
            .select({ state: schema.emailDeliveryTable.state })
            .from(schema.emailDeliveryTable)
            .where(eq(schema.emailDeliveryTable.id, delivery.deliveryId));
          expect(stored?.state).toBe("delivered");
        })
    );

    it.effect("ingests a permanent bounce and suppresses the recipient", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const webhook = yield* SesEmailFeedbackWebhook;
        const delivery = yield* makeDelivery("bounce@example.com");

        const outcome = yield* webhook.handle(
          snsNotification("sns-bounce-1", {
            eventType: "Bounce",
            mail: {
              timestamp: "2026-08-18T00:00:00.000Z",
              messageId: "01000178a3125d21-000001",
              source: "noreply@feeblo.com",
              destination: ["bounce@example.com"],
              headers: [{ name: "Message-ID", value: delivery.messageId }],
            },
            bounce: {
              bounceType: "Permanent",
              bounceSubType: "General",
              timestamp: "2026-08-18T00:00:01.000Z",
              bouncedRecipients: [
                {
                  emailAddress: "bounce@example.com",
                  action: "failed",
                  status: "5.1.1",
                  diagnosticCode: "smtp; 550 5.1.1 user unknown",
                },
              ],
            },
          })
        );

        expect(outcome).toMatchObject({
          _tag: "Ingested",
          result: { _tag: "Processed", suppressed: true },
        });
        const [suppression] = yield* db
          .select({ reason: schema.emailSuppressionTable.reason })
          .from(schema.emailSuppressionTable)
          .where(eq(schema.emailSuppressionTable.email, "bounce@example.com"));
        expect(suppression?.reason).toBe("hard_bounce");
      })
    );

    it.effect(
      "acknowledges send, open, click and rendering failure events without work",
      () =>
        Effect.gen(function* () {
          const webhook = yield* SesEmailFeedbackWebhook;

          for (const eventType of [
            "Send",
            "Open",
            "Click",
            "Rendering Failure",
          ]) {
            expect(
              yield* webhook.handle(
                snsNotification(`sns-${eventType}-1`, {
                  eventType,
                  mail: {
                    timestamp: "2026-08-18T00:00:00.000Z",
                    messageId: "01000178a3125d21-000002",
                    source: "noreply@feeblo.com",
                  },
                })
              )
            ).toEqual({ _tag: "Ignored" });
          }
        })
    );

    it.effect("acknowledges non-SES SNS notifications without work", () =>
      Effect.gen(function* () {
        const webhook = yield* SesEmailFeedbackWebhook;

        expect(
          yield* webhook.handle(
            snsNotification("sns-foreign-1", {
              eventType: "Unrelated",
            })
          )
        ).toEqual({ _tag: "Ignored" });
      })
    );

    it.layer(makeWebhookLayer(TestConfig, SubscriptionConfirmationFetch))(
      "subscription confirmation fetch",
      (it) => {
        it.effect("confirms an SNS subscription by fetching its URL", () =>
          Effect.gen(function* () {
            subscriptionConfirmationRequests.length = 0;
            const webhook = yield* SesEmailFeedbackWebhook;
            const subscribeUrl =
              "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc123";

            const outcome = yield* webhook.handle(
              snsSubscriptionConfirmation(subscribeUrl)
            );

            expect(outcome).toEqual({ _tag: "Confirmed" });
            expect(subscriptionConfirmationRequests).toEqual([
              SIGNING_CERT_URL,
              subscribeUrl,
            ]);
          })
        );
      }
    );

    it.layer(
      makeWebhookLayer(
        TestConfig,
        asFetch((input: RequestInfo | URL): Promise<Response> => {
          return String(input) === SIGNING_CERT_URL
            ? Promise.resolve(new Response(SIGNING_CERT_PEM, { status: 200 }))
            : Promise.resolve(
                new Response("service unavailable", { status: 503 })
              );
        })
      )
    )("subscription confirmation failures", (it) => {
      it.effect(
        "fails the subscription confirmation when the SubscribeURL responds non-2xx",
        () =>
          Effect.gen(function* () {
            const webhook = yield* SesEmailFeedbackWebhook;
            const subscribeUrl =
              "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc123";

            const outcome = yield* webhook
              .handle(snsSubscriptionConfirmation(subscribeUrl))
              .pipe(Effect.exit);

            const confirmationError = expectFailed(outcome);
            expect(confirmationError).toBeInstanceOf(
              SesWebhookConfirmationError
            );
            expect(confirmationError).toMatchObject({
              httpStatus: 503,
              operation: "SesEmailFeedbackWebhook.confirmSubscription",
            });
          })
      );
    });

    it.layer(
      makeWebhookLayer(
        TestConfig,
        // Never resolves so the certificate fetch races the virtual timeout.
        asFetch(
          (_input: RequestInfo | URL): Promise<Response> =>
            new Promise<Response>(() => {})
        )
      )
    )("signing certificate fetch timeout", (it) => {
      it.effect(
        "fails with an envelope error when the signing certificate fetch times out",
        () =>
          Effect.gen(function* () {
            const webhook = yield* SesEmailFeedbackWebhook;

            const outcome = yield* Effect.exit(
              Effect.gen(function* () {
                const fiber = yield* webhook
                  .handle(
                    snsNotification("sns-cert-timeout-1", {
                      eventType: "Unrelated",
                    })
                  )
                  .pipe(Effect.forkChild);
                yield* Effect.yieldNow;
                yield* TestClock.adjust("11 seconds");
                return yield* Fiber.join(fiber);
              })
            );

            const error = expectFailed(outcome);
            expect(error).toBeInstanceOf(SesWebhookEnvelopeError);
            expect(error).toMatchObject({
              operation: "SesEmailFeedbackWebhook.fetchSnsSigningCert",
            });
          })
      );
    });

    it.layer(
      makeWebhookLayer(
        TestConfig,
        asFetch((input: RequestInfo | URL): Promise<Response> => {
          if (String(input) === SIGNING_CERT_URL) {
            return Promise.resolve(
              new Response(SIGNING_CERT_PEM, { status: 200 })
            );
          }
          // Never resolves so the confirmation GET races the virtual timeout.
          return new Promise<Response>(() => {});
        })
      )
    )("subscription confirmation timeout", (it) => {
      it.effect(
        "fails with a confirmation error when the confirmation GET times out",
        () =>
          Effect.gen(function* () {
            const webhook = yield* SesEmailFeedbackWebhook;
            const subscribeUrl =
              "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc123";

            const outcome = yield* Effect.exit(
              Effect.gen(function* () {
                const fiber = yield* webhook
                  .handle(snsSubscriptionConfirmation(subscribeUrl))
                  .pipe(Effect.forkChild);
                yield* Effect.yieldNow;
                yield* TestClock.adjust("11 seconds");
                return yield* Fiber.join(fiber);
              })
            );

            const error = expectFailed(outcome);
            expect(error).toBeInstanceOf(SesWebhookConfirmationError);
            expect(error).toMatchObject({
              operation: "SesEmailFeedbackWebhook.confirmSubscription",
            });
          })
      );
    });

    it.effect("rejects an envelope from an unexpected SNS topic", () =>
      Effect.gen(function* () {
        const webhook = yield* SesEmailFeedbackWebhook;

        const outcome = yield* webhook
          .handle(
            signEnvelope({
              Type: "Notification",
              MessageId: "sns-other-topic-1",
              TopicArn: "arn:aws:sns:us-east-1:123456789012:some-other-topic",
              Message: stringifyJson({
                eventType: "Bounce",
                mail: { timestamp: "2026-08-18T00:00:00.000Z", messageId: "x" },
              }),
              Timestamp: "2026-08-18T00:00:02.000Z",
              SignatureVersion: "1",
              SigningCertURL: SIGNING_CERT_URL,
            })
          )
          .pipe(Effect.exit);

        const error = expectFailed(outcome);
        expect(error).toBeInstanceOf(SesWebhookEnvelopeError);
      })
    );

    it.effect("rejects a message whose signature does not verify", () =>
      Effect.gen(function* () {
        const webhook = yield* SesEmailFeedbackWebhook;

        const tampered = parseJsonObject(
          snsNotification("sns-tampered-1", {
            eventType: "Bounce",
            mail: { timestamp: "2026-08-18T00:00:00.000Z", messageId: "x" },
          })
        );
        const tamperedEnvelope = {
          ...tampered,
          Message: stringifyJson({ eventType: "Delivery" }),
        };
        const outcome = yield* webhook
          .handle(stringifyJson(tamperedEnvelope))
          .pipe(Effect.exit);

        const error = expectFailed(outcome);
        expect(error).toBeInstanceOf(SesWebhookEnvelopeError);
      })
    );

    it.effect("rejects an unsupported SNS signature version", () =>
      Effect.gen(function* () {
        const webhook = yield* SesEmailFeedbackWebhook;

        const unsupported = parseJsonObject(
          snsNotification("sns-version-1", {
            eventType: "Delivery",
            mail: { timestamp: "2026-08-18T00:00:00.000Z", messageId: "x" },
          })
        );
        const unsupportedEnvelope = {
          ...unsupported,
          SignatureVersion: "3",
        };
        const outcome = yield* webhook
          .handle(stringifyJson(unsupportedEnvelope))
          .pipe(Effect.exit);

        const error = expectFailed(outcome);
        expect(error).toBeInstanceOf(SesWebhookEnvelopeError);
      })
    );

    it.effect("verifies a SignatureVersion 2 message signed with SHA-256", () =>
      Effect.gen(function* () {
        const webhook = yield* SesEmailFeedbackWebhook;

        expect(
          yield* webhook.handle(
            snsNotification("sns-v2-1", { eventType: "Unrelated" }, "2")
          )
        ).toEqual({ _tag: "Ignored" });
      })
    );

    it.effect(
      "verifies signatures against a chained signing certificate bundle",
      () =>
        Effect.gen(function* () {
          const webhook = yield* SesEmailFeedbackWebhook;

          expect(
            yield* webhook.handle(
              signEnvelope({
                Type: "Notification",
                MessageId: "sns-chain-1",
                TopicArn: TEST_TOPIC_ARN,
                Message: stringifyJson({ eventType: "Unrelated" }),
                Timestamp: "2026-08-18T00:00:02.000Z",
                SignatureVersion: "1",
                SigningCertURL: SIGNING_CERT_CHAIN_URL,
              })
            )
          ).toEqual({ _tag: "Ignored" });
        })
    );

    it.effect(
      "rejects a signing certificate served from an untrusted host",
      () =>
        Effect.gen(function* () {
          const webhook = yield* SesEmailFeedbackWebhook;

          const outcome = yield* webhook
            .handle(
              signEnvelope({
                Type: "Notification",
                MessageId: "sns-untrusted-cert-1",
                TopicArn: TEST_TOPIC_ARN,
                Message: stringifyJson({
                  eventType: "Delivery",
                  mail: {
                    timestamp: "2026-08-18T00:00:00.000Z",
                    messageId: "x",
                  },
                }),
                Timestamp: "2026-08-18T00:00:02.000Z",
                SignatureVersion: "1",
                SigningCertURL: "https://evil.example.com/cert.pem",
              })
            )
            .pipe(Effect.exit);

          const error = expectFailed(outcome);
          expect(error).toBeInstanceOf(SesWebhookEnvelopeError);
        })
    );

    it.effect(
      "rejects a subscription confirmation with a non-SNS confirmation URL",
      () =>
        Effect.gen(function* () {
          const webhook = yield* SesEmailFeedbackWebhook;
          const outcome = yield* webhook
            .handle(
              snsSubscriptionConfirmation("http://evil.example.com/confirm")
            )
            .pipe(Effect.exit);

          const error = expectFailed(outcome);
          expect(error).toBeInstanceOf(SesWebhookConfirmationError);
        })
    );

    it.effect("rejects an envelope that is not recognized SNS JSON", () =>
      Effect.gen(function* () {
        const webhook = yield* SesEmailFeedbackWebhook;

        const outcome = yield* Effect.exit(webhook.handle("this is not JSON"));
        const error = expectFailed(outcome);
        expect(error).toBeInstanceOf(SesWebhookEnvelopeError);
      })
    );

    it.layer(NoTopicArnLayer)("with no configured topic ARN", (it) => {
      it.effect(
        "rejects a signed message because the topic cannot be verified",
        () =>
          Effect.gen(function* () {
            const webhook = yield* SesEmailFeedbackWebhook;

            const outcome = yield* webhook
              .handle(
                snsNotification("sns-no-arn-1", { eventType: "Unrelated" })
              )
              .pipe(Effect.exit);

            const error = expectFailed(outcome);
            expect(error).toBeInstanceOf(SesWebhookEnvelopeError);
          })
      );
    });
  });
});
