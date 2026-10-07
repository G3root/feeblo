// Composition root: wires all layers and starts the HTTP server.
import { createServer } from "node:http";

import {
  NodeCrypto,
  NodeFileSystem,
  NodeHttpServer,
  NodePath,
  NodeRuntime,
} from "@effect/platform-node";
import { Database } from "@feeblo/db";
import { BillingRepository } from "@feeblo/domain/billing/repository";
import { subscriptionRevocationMaintenance } from "@feeblo/domain/billing/revocation";
import { PolarService } from "@feeblo/domain/billing/service";
import { WebhookIntegrationConfig } from "@feeblo/domain/integration/config";
import { DiscordIntegrationConfig } from "@feeblo/domain/integration/discord/config";
import { ExternalResourceServiceLive } from "@feeblo/domain/integration/external-resource/live";
import { ExternalResourceService } from "@feeblo/domain/integration/external-resource/service";
import { SlackIntegrationConfig } from "@feeblo/domain/integration/slack/config";
import { Mailer } from "@feeblo/transactional/mailer";
import {
  makeMailerTestLayer,
  TestMailer,
} from "@feeblo/transactional/mailer/test";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../config";
import { makeSentryLayer } from "../infra/sentry";
import { makeIntegrationLayers } from "../integrations";
import {
  makeAuthLayer,
  makeDiscordIntegrationConfig,
  makeGitHubConfigLayer,
  makeRateLimitLayer,
  makeServiceLayers,
  makeSlackIntegrationConfig,
  makeWebhookIntegrationConfig,
  makeWorkflowLayer,
} from "./layers";
import {
  makeMergedRoutes,
  makePublicRouters,
  withGlobalMiddleware,
} from "./router";

export const program = Effect.gen(function* () {
  const config = yield* ServerConfig;

  const useTestMailer = yield* Config.Boolean("E2E_TEST_MAILER").pipe(
    Config.withDefault(false)
  );
  const mailbox = useTestMailer ? yield* TestMailer.make : undefined;
  const makeMailerLayer = (): Layer.Layer<
    Mailer,
    Layer.Error<typeof Mailer.layer>
  > => (mailbox ? makeMailerTestLayer(mailbox) : Mailer.layer);

  const WorkFlowLayer = makeWorkflowLayer(mailbox, makeMailerLayer);
  const RateLimitLayer = makeRateLimitLayer(config);
  const AuthLayer = makeAuthLayer(makeMailerLayer, RateLimitLayer);

  // Built once so the integration kernel and the HTTP layer tree share a
  // single instance instead of building sibling copies in separate memo
  // scopes.
  const externalResourceContext = yield* Layer.build(
    ExternalResourceServiceLive
  );
  const externalResources = Context.get(
    externalResourceContext,
    ExternalResourceService
  );

  const integrationRuntime = yield* makeIntegrationLayers.pipe(
    Effect.provideService(ServerConfig, config),
    Effect.provideService(
      SlackIntegrationConfig,
      makeSlackIntegrationConfig(config)
    ),
    Effect.provideService(
      DiscordIntegrationConfig,
      makeDiscordIntegrationConfig(config)
    ),
    Effect.provideService(
      WebhookIntegrationConfig,
      makeWebhookIntegrationConfig(config)
    ),
    Effect.provideService(ExternalResourceService, externalResources)
  );

  const GitHubConfigLayer = makeGitHubConfigLayer(config);
  const SlackConfigLayer = Layer.succeed(
    SlackIntegrationConfig,
    makeSlackIntegrationConfig(config)
  );
  const DiscordConfigLayer = Layer.succeed(
    DiscordIntegrationConfig,
    makeDiscordIntegrationConfig(config)
  );

  const ServiceLayers = makeServiceLayers({
    config,
    externalResourceService: externalResources,
    gitHubConfigLayer: GitHubConfigLayer,
    integrationRuntime,
    discordConfigLayer: DiscordConfigLayer,
    slackConfigLayer: SlackConfigLayer,
    workflowLayer: WorkFlowLayer,
  });

  const PublicRouters = makePublicRouters(mailbox, config.nodeEnv);
  const MergedRoutes = makeMergedRoutes({
    appUrl: config.appUrl,
    integrationRuntime,
    publicRouters: PublicRouters,
  });
  const AllRoutes = withGlobalMiddleware(MergedRoutes, config);

  const server = HttpRouter.serve(AllRoutes, {
    routerConfig: {
      maxParamLength: 500,
    },
  }).pipe(
    Layer.provide(AuthLayer),
    Layer.provide(RateLimitLayer),
    Layer.provide(ServiceLayers),
    Layer.provide(NodeFileSystem.layer),
    Layer.provide(NodePath.layer),
    Layer.provide(
      NodeHttpServer.layerConfig(
        createServer,
        Config.all({
          port: Config.Number("SERVER_PORT").pipe(Config.withDefault(3000)),
        })
      )
    )
  );

  yield* integrationRuntime.worker.pipe(Effect.forkScoped);
  yield* integrationRuntime.maintenance.pipe(Effect.forkScoped);

  // The Polar client and the revocation queue are built here so a queued
  // revocation keeps retrying after the request that deleted the workspace has
  // already returned. `Layer.build` keeps them in this program's scope, next
  // to the other forked workers.
  const billingRuntime = yield* Layer.build(
    Layer.mergeAll(BillingRepository.layer, PolarService.layer)
  );
  yield* subscriptionRevocationMaintenance.pipe(
    Effect.provide(billingRuntime),
    Effect.forkScoped
  );

  return yield* Layer.launch(server);
});

// Sentry must wrap the entire program (layer construction, forked workers,
// and server execution), not just the HTTP server layer.
const SentryLiveLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    return makeSentryLayer(config);
  })
).pipe(Layer.provideMerge(ServerConfig.layer));

export const main = program.pipe(
  Effect.scoped,
  // This is the application's entry point: everything the server needs is
  // composed here, exactly as the rule asks.
  // eslint-disable-next-line effecttsgo/strict-effect-provide -- application entry point
  Effect.provide(
    Layer.mergeAll(
      SentryLiveLayer,
      Database.DatabaseContextLive,
      NodeCrypto.layer
    )
  )
);

export const runProgram = () => NodeRuntime.runMain(main);
