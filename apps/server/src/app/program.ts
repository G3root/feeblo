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
import * as Etag from "effect/http/Etag";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";
import type * as HttpServer from "effect/http/HttpServer";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../config";
import { makeObservabilityLayer } from "../infra/observability";
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

/**
 * The composition root's interface.
 *
 * `makeServerApp` builds the route tree and the integration runtime without
 * binding a port, and returns `makeServer`, which closes over that tree and
 * takes the one layer a caller owns: the HTTP server. `program` supplies
 * `NodeHttpServer`; a test supplies an in-memory server and builds the same
 * tree over PGlite and test configs. That is the gap ADR 0006 recorded — no
 * test built the server layers, so a collaborator missing from `ServiceLayers`
 * stayed invisible until a request asked for it.
 *
 * The layers are provided after `HttpRouter.serve`, exactly as before: the
 * serve step is what unwraps the `Request` markers the route and middleware
 * layers carry, so the `Layer.provide`s can subtract the services they name.
 */
export const makeServerApp = Effect.gen(function* () {
  const config = yield* ServerConfig;

  const mailbox = config.e2eTestMailer ? yield* TestMailer.make : undefined;
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

  const PublicRouters = makePublicRouters({
    e2eRoutesEnabled: config.e2eRoutesEnabled,
    mailbox,
    nodeEnv: config.nodeEnv,
  });
  const MergedRoutes = makeMergedRoutes({
    appUrl: config.appUrl,
    integrationRuntime,
    publicRouters: PublicRouters,
  });
  const AllRoutes = withGlobalMiddleware(MergedRoutes, config);

  return {
    integrationRuntime,
    makeServer: <E, R>(
      platform: Layer.Layer<
        HttpServer.HttpServer | HttpPlatform.HttpPlatform | Etag.Generator,
        E,
        R
      >
    ) =>
      HttpRouter.serve(AllRoutes, {
        routerConfig: {
          maxParamLength: 500,
        },
      }).pipe(
        Layer.provide(AuthLayer),
        Layer.provide(RateLimitLayer),
        Layer.provide(ServiceLayers),
        Layer.provide(NodeFileSystem.layer),
        Layer.provide(NodePath.layer),
        Layer.provide(platform)
      ),
  };
});

export const program = Effect.gen(function* () {
  const { integrationRuntime, makeServer } = yield* makeServerApp;

  const server = makeServer(
    NodeHttpServer.layerConfig(
      createServer,
      Config.all({
        port: Config.Number("SERVER_PORT").pipe(Config.withDefault(3000)),
      })
    )
  );

  yield* integrationRuntime.worker.pipe(Effect.forkScoped);
  yield* integrationRuntime.maintenance.pipe(Effect.forkScoped);

  // The Polar client and the revocation queue are built here so a queued
  // revocation keeps retrying after the request that deleted the workspace has
  // already returned. `Layer.build` keeps them in this program's scope, next
  // to the other forked workers. PolarService is provided into the repository
  // layer (which reads the configured target from it) and merged alongside it,
  // because the revocation pass reads the service directly.
  const billingRuntime = yield* Layer.build(
    Layer.mergeAll(
      BillingRepository.layer.pipe(Layer.provide(PolarService.layer)),
      PolarService.layer
    )
  );
  yield* subscriptionRevocationMaintenance.pipe(
    Effect.provide(billingRuntime),
    Effect.forkScoped
  );

  return yield* Layer.launch(server);
});

// Observability must wrap the entire program (layer construction, forked
// workers, and server execution), not just the HTTP server layer.
const ObservabilityLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    return makeObservabilityLayer(config);
  })
).pipe(Layer.provideMerge(ServerConfig.layer));

export const main = program.pipe(
  Effect.scoped,
  // This is the application's entry point: everything the server needs is
  // composed here, exactly as the rule asks.
  // eslint-disable-next-line effecttsgo/strict-effect-provide -- application entry point
  Effect.provide(
    Layer.mergeAll(
      ObservabilityLayer,
      Database.DatabaseContextLive,
      NodeCrypto.layer
    )
  )
);

export const runProgram = () => NodeRuntime.runMain(main);
