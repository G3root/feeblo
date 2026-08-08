import { Database, schema } from "@feeblo/db";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { PostSubscriptionRepository } from "../post-subscription/repository";
import { EmailConfig } from "./config";
import { verifyUnsubscribeToken } from "./unsubscribe";

const page = (title: string, body: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} — Feeblo</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center;
             background: #0c0d0f; color: #e8e9eb; font-family: system-ui, sans-serif; }
      main { max-width: 32rem; padding: 2rem; text-align: center; }
      h1 { font-size: 1.25rem; }
      p { color: #9ba1a8; line-height: 1.5; }
      a { color: #e8e9eb; }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${body}</p>
    </main>
  </body>
</html>`;

const donePage = (postTitle: string) =>
  page(
    "You're unsubscribed",
    `You will no longer receive email updates about "${postTitle}". You can
     manage your notification preferences anytime from your workspace settings.`
  );

const invalidPage = page(
  "Unsubscribe link invalid",
  "This unsubscribe link is invalid or has expired. If you keep getting emails, manage your notification preferences from your workspace settings."
);

/**
 * Stateless unsubscribe endpoint: validates the signed token (signature +
 * audience + expiry — no database rows) and applies the action through the
 * existing post-subscription code.
 */
export const EmailUnsubscribeRouter: Layer.Layer<
  never,
  never,
  HttpRouter.HttpRouter
> = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const db = yield* Database.Database;
    const config = yield* EmailConfig;
    const subscriptionRepository = yield* PostSubscriptionRepository;

    return yield* router.add("GET", "/api/email/unsubscribe", (request) =>
      Effect.gen(function* () {
        const token = new URL(request.url, "http://localhost").searchParams.get(
          "token"
        );
        if (!token) {
          return HttpServerResponse.html(invalidPage);
        }

        const payload = yield* verifyUnsubscribeToken(token).pipe(
          Effect.provideService(EmailConfig, config),
          Effect.match({
            onFailure: () => null,
            onSuccess: (value) => value,
          })
        );
        if (payload === null) {
          return HttpServerResponse.html(invalidPage);
        }

        const { memberId, postId } = payload;
        const member = yield* db.query.memberTable.findFirst({
          where: { id: memberId },
          columns: { userId: true },
        });
        if (!member) {
          return HttpServerResponse.html(invalidPage);
        }

        const postTitle = yield* db
          .select({ title: schema.postTable.title })
          .from(schema.postTable)
          .where(eq(schema.postTable.id, postId))
          .limit(1)
          .pipe(Effect.map((rows) => rows[0]?.title ?? "this post"));

        yield* subscriptionRepository.unsubscribe({
          postId,
          userId: member.userId,
        });

        return HttpServerResponse.html(donePage(postTitle));
      }).pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, request),
        Effect.orDie
      )
    );
  })
).pipe(
  Layer.provide(PostSubscriptionRepository.layer),
  Layer.provide(EmailConfig.layer),
  Layer.provide(Database.DatabaseContextLive),
  Layer.orDie
);
