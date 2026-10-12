import { NodeCrypto, NodeHttpServer } from "@effect/platform-node";
import { layer } from "@effect/vitest";
import { Database } from "@feeblo/db";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../config";
import { makeServerApp } from "./program";

/**
 * The composition root builds in a test.
 *
 * `program.ts` is the only code that assembles the production layer tree, and
 * until this test nothing in `pnpm test` built it: a collaborator missing from
 * `ServiceLayers` stayed invisible until a request asked for it (ADR 0006).
 * The same `makeServerApp` production uses is built here with
 * `NodeHttpServer.layerTest` in place of the bound port, a real PGlite database
 * in place of Postgres, and the test configs the Public API harness already
 * proves out. A missing layer, a config read that is not in the environment, or
 * a provider whose handler layer is absent all fail this build instead of one
 * request.
 *
 * `makeServer` is the composition root's interface: production supplies
 * `NodeHttpServer.layerConfig`, this test supplies the ephemeral test server,
 * and the route tree in between is the one that ships.
 */

/**
 * The environment the build reads. The values are the smallest ones the
 * production layers accept: a PGlite database, a deterministic auth secret,
 * the test mailer, and the media variables `S3Config` requires. `ServerConfig`
 * is the real layer, so this also proves the config path parses.
 */
const TestConfigProvider = ConfigProvider.fromUnknown({
  API_URL: "https://api.feeblo.test",
  APP_ROOT_DOMAIN: "feeblo.test",
  APP_URL: "https://app.feeblo.test",
  AUTH_ENCRYPTION_KEY: "test-auth-encryption-key-0123456789abcdef",
  DATABASE_URL: "pglite:memory://",
  E2E_ROUTES_ENABLED: "true",
  E2E_TEST_MAILER: "true",
  INTEGRATION_ENCRYPTION_KEY:
    "test-integration-encryption-key-0123456789abcdef",
  MEDIA_PUBLIC_BASE_URL: "https://media.feeblo.test",
  MEDIA_PUBLIC_BUCKET_NAME: "feeblo-test",
  MEDIA_UPLOAD_ENDPOINT: "https://media.feeblo.test",
  MEDIA_UPLOAD_REGION: "auto",
});

/** The provider as a layer, for the layers that read it while they build. */
const TestConfig = ConfigProvider.layer(TestConfigProvider);

const TestEnvironment = Layer.mergeAll(
  ServerConfig.layer.pipe(Layer.provide(TestConfig)),
  Database.DatabaseContextLive.pipe(Layer.provide(TestConfig)),
  NodeCrypto.layer,
  TestConfig
);

layer(TestEnvironment)("server composition", (it) => {
  it.effect("builds the production route tree over PGlite", () =>
    Effect.gen(function* () {
      const { makeServer } = yield* makeServerApp;

      // `Layer.build` runs every layer the server runs, including the
      // integration registry validation, the auth handler construction, and
      // the route tree's own providers. A collaborator missing from
      // `ServiceLayers` fails here, in `pnpm test`, instead of at request time.
      yield* Layer.build(
        makeServer(NodeHttpServer.layerTest).pipe(Layer.provide(TestConfig))
      );
    })
  );
});
