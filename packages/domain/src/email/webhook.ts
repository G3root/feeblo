import { createHmac, timingSafeEqual } from "node:crypto";
import { Database } from "@feeblo/db";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as S from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { EmailConfig } from "./config";
import { EmailEventRepository } from "./repository";

export const EmailWebhookEvent = S.Struct({
  type: S.Literals(["hard_bounce", "complaint"]),
  email: S.String,
  messageId: S.optional(S.String),
});

export type TEmailWebhookEvent = S.Schema.Type<typeof EmailWebhookEvent>;

export const EmailWebhookPayload = S.Struct({
  events: S.Array(EmailWebhookEvent),
});

export type TEmailWebhookPayload = S.Schema.Type<typeof EmailWebhookPayload>;

const signatureHeader = "x-feeblo-signature";
const signaturePrefixPattern = /^sha256=/;

/**
 * Verifies the `X-Feeblo-Signature: sha256=<hex-hmac>` header over the raw
 * body when a shared webhook secret is configured. Provider-agnostic: any
 * provider (Resend/Postmark/SES) can plug in by forwarding normalized
 * { type, email, messageId } events and signing with the shared secret.
 */
export const verifySignature = (
  rawBody: string,
  secret: string,
  headerValue: string | undefined
): boolean => {
  if (!headerValue) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = headerValue.replace(signaturePrefixPattern, "");
  if (expected.length !== provided.length) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(provided, "hex")
  );
};

const badRequest = (message: string) =>
  HttpServerResponse.jsonUnsafe({ error: message }, { status: 400 });

const unauthorized = HttpServerResponse.jsonUnsafe(
  { error: "Invalid signature" },
  { status: 401 }
);

const parsePayload = (
  rawBody: string
): Effect.Effect<TEmailWebhookPayload | null> =>
  // The raw body must be read as text first for HMAC verification, so the
  // payload is parsed from that string here.
  Effect.sync(() => {
    try {
      return JSON.parse(rawBody) as unknown;
    } catch {
      return null;
    }
  }).pipe(
    Effect.flatMap((body) =>
      body === null
        ? Effect.succeed(null)
        : S.decodeUnknownEffect(EmailWebhookPayload)(body).pipe(
            Effect.catch(() => Effect.succeed(null))
          )
    )
  );

/**
 * Bounce/complaint webhook ingestion. Records the event on `email_delivery`
 * rows (bounced_at / complained_at) and inserts into `suppressed_email` so
 * future dispatches skip the address. SMTP-only deployments can leave
 * `EMAIL_WEBHOOK_SECRET` unset (requests are accepted for local dev); set it
 * in production so forged events are rejected.
 */
export const EmailWebhookRouter: Layer.Layer<
  never,
  never,
  HttpRouter.HttpRouter
> = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const repository = yield* EmailEventRepository;
    const config = yield* EmailConfig;
    const db = yield* Database.Database;

    return yield* router.add(
      "POST",
      "/api/email/webhooks/:provider",
      (request) =>
        Effect.gen(function* () {
          const rawBody = yield* request.text.pipe(
            Effect.match({
              onFailure: () => null,
              onSuccess: (text) => text,
            })
          );
          if (rawBody === null) {
            return badRequest("Invalid body");
          }

          if (config.webhookSecret !== null) {
            const signature = request.headers[signatureHeader];
            if (
              signature === undefined ||
              !verifySignature(rawBody, config.webhookSecret, signature)
            ) {
              return unauthorized;
            }
          }

          const payload = yield* parsePayload(rawBody);
          if (payload === null) {
            return badRequest("Invalid payload");
          }

          yield* Effect.forEach(
            payload.events,
            (event) =>
              repository
                .recordBounceOrComplaint({
                  email: event.email,
                  messageId: event.messageId,
                  type: event.type,
                })
                .pipe(Effect.provideService(Database.Database, db)),
            { concurrency: 4 }
          );

          return HttpServerResponse.jsonUnsafe({
            received: payload.events.length,
          });
        }).pipe(Effect.orDie)
    );
  })
).pipe(
  Layer.provide(EmailEventRepository.layer),
  Layer.provide(EmailConfig.layer),
  Layer.provide(Database.DatabaseContextLive),
  Layer.orDie
);
