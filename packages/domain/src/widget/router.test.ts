import { expectTypeOf, it } from "@effect/vitest";
import { Database } from "@feeblo/db";
import type { Layer } from "effect/Layer";

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
import { WidgetApiRoute } from "./router";

/**
 * Where the surface draws its dependency line.
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
 * or if a private one leaks back into the channel and every caller has to
 * restate the widget's wiring.
 */

type RequirementsOf<L> =
  L extends Layer<infer _A, infer _E, infer R> ? R : never;

type RouteRequirements = RequirementsOf<typeof WidgetApiRoute>;

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
