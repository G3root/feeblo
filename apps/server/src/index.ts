/**
 * Server entrypoint — thin bootstrap.
 *
 * All wiring lives in `app/program.ts` and the `http/` + `infra/` modules so
 * this file stays stable and the composition root is testable in isolation.
 *
 * Architecture:
 *   config.ts              → typed env (ServerConfig)
 *   infra/redis.ts         → redisOptions
 *   infra/sentry.ts        → makeSentryLayer
 *   http/body-limit.ts     → bodySizeLimitMiddleware + BetterAuth body guard
 *   http/cors.ts           → makeIsAllowedOrigin
 *   http/server-timing.ts  → serverTimingMiddleware
 *   http/routers.ts        → Health, Root, Docs, OgImage, BetterAuth routers
 *   http/e2e.ts            → test mailbox + Playwright seed routers
 *   http/ses.ts            → SES email feedback webhook router
 *   app/layers.ts          → RateLimit, Workflow, Auth, Service layers
 *   app/router.ts          → MergedRoutes + global middleware
 *   app/program.ts         → Effect.gen program + NodeRuntime bootstrap
 *   integrations.ts        → provider registry + delivery worker
 *   github-provider.ts     → GitHub App provider Live
 *   slack.ts / discord.ts / github.ts → feature routers
 */
import { runProgram } from "./app/program";

void runProgram;
