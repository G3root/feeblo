import { NodeCrypto } from "@effect/platform-node";
import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { TestClock } from "effect/testing";

import { JwtSecretRepository } from "../jwt-secret/repository";
import { verifyJwt } from "../jwt-secret/verification";
import { CurrentSession, type Session } from "../session-middleware";
import { FeedbackWidgetConfig } from "./config";
import { WidgetRpcHandlersEffect } from "./handlers";

const fixtureNow = new Date("2026-08-11T00:00:00.000Z");
const WIDGET_ORGANIZATION_ID = "org_widget";

/**
 * The deployed shape: one workspace owns the widget, and the person
 * submitting is signed in somewhere else entirely. That is why the audience is
 * configuration and not the caller's organization.
 */
const makeSession = (overrides: { name?: string } = {}): Session => ({
  user: {
    id: "user_submitter",
    email: "ada@example.com",
    name: overrides.name ?? "Ada Lovelace",
    restrictedToOrganizationId: null,
  },
  session: { userId: "user_submitter", token: "test-token" },
  organizations: [],
  memberships: [],
});

/**
 * Creates the workspace row the widget's foreign keys point at. Idempotent:
 * every test in a suite shares one PGlite database and the widget workspace id
 * is fixed by that suite's config layer.
 */
const ensureWidgetWorkspace = (organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    yield* db
      .insert(schema.organizationTable)
      .values({
        id: organizationId,
        name: "Widget workspace",
        slug: organizationId,
        createdAt: yield* DateTime.nowAsDate,
      })
      .onConflictDoNothing();
  });

const makeTestLayer = (organizationId: string | undefined) =>
  Layer.mergeAll(
    JwtSecretRepository.layer.pipe(
      Layer.provideMerge(Database.PgliteDatabaseLive)
    ),
    FeedbackWidgetConfig.layerTest({ organizationId }),
    NodeCrypto.layer
  );

describe("WidgetRpcHandlers without a configured widget", () => {
  layer(makeTestLayer(undefined))("handlers", (it) => {
    it.effect("reports that this deployment has no widget", () =>
      Effect.gen(function* () {
        const handlers = yield* WidgetRpcHandlersEffect;
        yield* TestClock.setTime(fixtureNow.getTime());

        const error = yield* Effect.flip(
          handlers
            .GetFeedbackWidgetIdentity()
            .pipe(Effect.provideService(CurrentSession, makeSession()))
        );

        expect(error._tag).toBe("NotFoundError");
      })
    );
  });
});

describe("WidgetRpcHandlers", () => {
  layer(makeTestLayer(WIDGET_ORGANIZATION_ID))("handlers", (it) => {
    it.effect("fails when the widget workspace has no signing secret", () =>
      Effect.gen(function* () {
        const handlers = yield* WidgetRpcHandlersEffect;
        yield* TestClock.setTime(fixtureNow.getTime());
        yield* ensureWidgetWorkspace(WIDGET_ORGANIZATION_ID);

        const error = yield* Effect.flip(
          handlers
            .GetFeedbackWidgetIdentity()
            .pipe(Effect.provideService(CurrentSession, makeSession()))
        );

        expect(error._tag).toBe("InternalServerError");
      })
    );

    it.effect("mints a token the widget verifies as the session user", () =>
      Effect.gen(function* () {
        const handlers = yield* WidgetRpcHandlersEffect;
        const repository = yield* JwtSecretRepository;
        yield* TestClock.setTime(fixtureNow.getTime());
        yield* ensureWidgetWorkspace(WIDGET_ORGANIZATION_ID);

        yield* repository.rotate({ organizationId: WIDGET_ORGANIZATION_ID });
        const secrets = yield* repository.getSecretsForOrg({
          organizationId: WIDGET_ORGANIZATION_ID,
        });
        const active = secrets.find((secret) => secret.revokedAt === null);

        const identity = yield* handlers
          .GetFeedbackWidgetIdentity()
          .pipe(Effect.provideService(CurrentSession, makeSession()));

        expect(identity.user).toEqual({
          email: "ada@example.com",
          id: "user_submitter",
          name: "Ada Lovelace",
        });
        expect(active).toBeDefined();

        const payload = yield* verifyJwt(
          identity.token,
          [active?.secret ?? ""],
          WIDGET_ORGANIZATION_ID
        );

        expect(payload.sub).toBe(identity.user.id);
        expect(payload.email).toBe(identity.user.email);
        expect(payload.name).toBe(identity.user.name);
      })
    );

    it.effect("names a blank display name by the address instead", () =>
      Effect.gen(function* () {
        const handlers = yield* WidgetRpcHandlersEffect;
        const repository = yield* JwtSecretRepository;
        yield* TestClock.setTime(fixtureNow.getTime());
        yield* ensureWidgetWorkspace(WIDGET_ORGANIZATION_ID);

        yield* repository.rotate({ organizationId: WIDGET_ORGANIZATION_ID });

        const identity = yield* handlers
          .GetFeedbackWidgetIdentity()
          .pipe(
            Effect.provideService(CurrentSession, makeSession({ name: " " }))
          );

        expect(identity.user.name).toBe("ada@example.com");
      })
    );
  });
});
