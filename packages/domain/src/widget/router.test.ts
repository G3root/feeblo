import { expect, expectTypeOf, it } from "@effect/vitest";
import { Database } from "@feeblo/db";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AttributeDefinitionRepository } from "../attribute-definition/repository";
import { BoardRepository } from "../board/repository";
import { ChangelogRepository } from "../changelog/repository";
import { CompanyRepository } from "../company/repository";
import { ContactRepository } from "../contact/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import { JwtSecretRepository } from "../jwt-secret/repository";
import { OrganizationRepository } from "../organization/repository";
import { PostStatusRepository } from "../post-status/repository";
import { PostEmbeddingService } from "../post/embedding-service";
import { PostRepository } from "../post/repository";
import { PostWriteService } from "../post/write";
import { RateLimitService } from "../rate-limit/service";
import { SitePolicy } from "../site/policies";
import { makeWidgetRoute, WidgetApiInternals, WidgetApiRoute } from "./router";

/**
 * Where the surface draws its dependency line, and how a caller moves it.
 *
 * ADR 0006 splits a surface's environment in two: the layers only it reads are
 * closed over in the surface's own bundle, and everything it shares with the
 * rest of the server stays in the route layer's requirement channel so the
 * composition root supplies one instance and a test supplies only its
 * substitute. Before this split the widget listed the same collaborator twice —
 * once as a `yield*`, once as an `Effect.provideService` — so neither half was
 * proven, and a collaborator missing from a provided layer died at request time
 * rather than at composition.
 *
 * These assertions are that proof. They fail if a shared service is quietly
 * closed over (the root would stop supplying it and nothing else would notice),
 * if a private one leaks back into the channel, or if `makeWidgetRoute` stops
 * composing the bundle it is handed.
 */

type RequirementsOf<L> =
  L extends Layer.Layer<infer _A, infer _E, infer R> ? R : never;

type RouteRequirements = RequirementsOf<typeof WidgetApiRoute>;

/**
 * An allow-everything site policy: what a widget contract test supplies instead
 * of the root's real policy so its fixtures decide the changelog's visibility.
 */
const AllowAllSitePolicy = SitePolicy.of({
  canHidePoweredByBranding: () => Effect.undefined,
  canManageSite: () => Effect.undefined,
  canViewChangelog: () => Effect.undefined,
  canViewRoadmap: () => Effect.undefined,
});

/**
 * A substitute bundle: the widget's own repositories over an in-memory PGlite
 * database, plus its own site policy. Both are layers a widget handler
 * actually reads — `listWidgetUpdates` reads `SitePolicy`, and every
 * repository reads the database — so this is the composition a widget HTTP
 * contract test needs, and the one the assertions below describe.
 */
const SubstituteInternals = Layer.mergeAll(
  WidgetApiInternals,
  Layer.succeed(SitePolicy, AllowAllSitePolicy)
).pipe(Layer.provide(Database.PgliteDatabaseLive));

const SubstitutedRoute = makeWidgetRoute({ internals: SubstituteInternals });

type SubstitutedRequirements = RequirementsOf<typeof SubstitutedRoute>;

it("requires every service the widget shares with the rest of the server", () => {
  // `WidgetApiDependencies` names these and `WidgetApiInternals` does not
  // provide them, so the composition root's `makeServiceLayers` is what makes
  // the route buildable. `SitePolicy` is the one the widget converted from a
  // per-surface build to a shared requirement; the rest already were.
  expectTypeOf<
    Extract<RouteRequirements, Database.Database>
  >().toEqualTypeOf<Database.Database>();
  expectTypeOf<
    Extract<RouteRequirements, EntitlementPolicy>
  >().toEqualTypeOf<EntitlementPolicy>();
  expectTypeOf<
    Extract<RouteRequirements, PostEmbeddingService>
  >().toEqualTypeOf<PostEmbeddingService>();
  expectTypeOf<
    Extract<RouteRequirements, PostWriteService>
  >().toEqualTypeOf<PostWriteService>();
  expectTypeOf<
    Extract<RouteRequirements, RateLimitService>
  >().toEqualTypeOf<RateLimitService>();
  expectTypeOf<
    Extract<RouteRequirements, SitePolicy>
  >().toEqualTypeOf<SitePolicy>();
});

it("closes over the layers only the widget reads", () => {
  expectTypeOf<
    Extract<RouteRequirements, AttributeDefinitionRepository>
  >().toEqualTypeOf<never>();
  expectTypeOf<
    Extract<RouteRequirements, BoardRepository>
  >().toEqualTypeOf<never>();
  expectTypeOf<
    Extract<RouteRequirements, ChangelogRepository>
  >().toEqualTypeOf<never>();
  expectTypeOf<
    Extract<RouteRequirements, CompanyRepository>
  >().toEqualTypeOf<never>();
  expectTypeOf<
    Extract<RouteRequirements, ContactRepository>
  >().toEqualTypeOf<never>();
  expectTypeOf<
    Extract<RouteRequirements, JwtSecretRepository>
  >().toEqualTypeOf<never>();
  expectTypeOf<
    Extract<RouteRequirements, OrganizationRepository>
  >().toEqualTypeOf<never>();
  expectTypeOf<
    Extract<RouteRequirements, PostRepository>
  >().toEqualTypeOf<never>();
  expectTypeOf<
    Extract<RouteRequirements, PostStatusRepository>
  >().toEqualTypeOf<never>();
});

it("lets the bundle it is handed decide the route's requirement channel", () => {
  // The default composition takes the workspace's site policy from the root,
  // because whether a changelog is public is the workspace's decision and every
  // surface applies the same policy.
  expectTypeOf<
    Extract<RouteRequirements, SitePolicy>
  >().toEqualTypeOf<SitePolicy>();

  // The substitute supplies it, and `Layer.provide` subtracts what the bundle
  // provides: the composed route no longer requires it. This is what fails if
  // `makeWidgetRoute` ignores its argument, or if the argument stops being the
  // layer the route is built over — the parameter is load-bearing, not a label.
  expectTypeOf<
    Extract<SubstitutedRequirements, SitePolicy>
  >().toEqualTypeOf<never>();

  // Everything the substitute does not supply is still required, so the
  // substitution narrows the channel rather than widening it: the shared write
  // path and the rate limiter stay the root's.
  expectTypeOf<
    Extract<SubstitutedRequirements, PostWriteService>
  >().toEqualTypeOf<PostWriteService>();
  expectTypeOf<
    Extract<SubstitutedRequirements, RateLimitService>
  >().toEqualTypeOf<RateLimitService>();
  expectTypeOf<
    Extract<SubstitutedRequirements, Database.Database>
  >().toEqualTypeOf<Database.Database>();
});

it.effect("builds the substitute bundle over an in-memory database", () =>
  Effect.gen(function* () {
    // The assertion above is only worth anything if the bundle it talks about
    // is a real layer: nine repositories over PGlite, and the test's own policy
    // as the one a handler would read.
    const context = yield* Layer.build(SubstituteInternals);

    expect(Context.get(context, SitePolicy)).toBe(AllowAllSitePolicy);
    expect(Context.get(context, BoardRepository)).toBeDefined();
    expect(Context.get(context, ChangelogRepository)).toBeDefined();
  })
);
