import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as Layer from "effect/Layer";

import { AttributeDefinitionRepository } from "../attribute-definition/repository";
import { BoardRepository } from "../board/repository";
import { ChangelogRepository } from "../changelog/repository";
import { CompanyRepository } from "../company/repository";
import { ContactRepository } from "../contact/repository";
import { JwtSecretRepository } from "../jwt-secret/repository";
import { OrganizationRepository } from "../organization/repository";
import { PostStatusRepository } from "../post-status/repository";
import { PostRepository } from "../post/repository";
import { WidgetApi } from "./api-contract";
import { WidgetApiLive } from "./api-live";

/**
 * The repositories the widget's handlers read and no other part of the server
 * assembles for them.
 *
 * They are closed over so the route does not require them: the widget is the
 * only surface that reads a workspace's attribute definitions, its JWT secret,
 * and the board/contact/company/post rows a submission resolves through at
 * composition time, so a new private dependency is one line here rather than
 * an edit in the composition root and every test that builds a server. This is
 * the same line `PublicApiInternals` draws (`../public-api/router.ts`); see
 * docs/adr/0006.
 *
 * Everything the widget shares with the rest of the server stays a requirement
 * of the route instead: the database, the rate limiter, the plan decision, the
 * site policy, `PostWriteService`, `PostEmbeddingService`, and the
 * request-scoped `ClientIp` the rate limiter reads. The composition root
 * supplies the real service and a test supplies only the substitute it needs,
 * without restating the surface's private wiring.
 */
export const WidgetApiInternals = Layer.mergeAll(
  AttributeDefinitionRepository.layer,
  BoardRepository.layer,
  ChangelogRepository.layer,
  CompanyRepository.layer,
  ContactRepository.layer,
  JwtSecretRepository.layer,
  OrganizationRepository.layer,
  PostRepository.layer,
  PostStatusRepository.layer
);

/**
 * Builds the route with a given private bundle.
 *
 * `makePublicApiRoute` takes the key middleware so a test can compose the same
 * route with a smaller rate-limit budget instead of re-declaring the route
 * shape, which is what would let the test drift from what ships. This takes the
 * internals bundle for the same reason: a test composes the widget's own route
 * over an in-memory database, or with its own `SitePolicy`, and the route it
 * gets is the one production mounts.
 *
 * The bundle is not defaulted, and that is a type-level constraint rather than
 * a preference. `Layer` is invariant in the services it provides, so a default
 * of `WidgetApiInternals` can only typecheck against an `internals` parameter
 * whose output is pinned to `WidgetInternals` — and a pinned output would hide
 * the one thing the parameter is for: `Layer.provide` subtracts what the bundle
 * provides, so a substitute that also supplies a shared service (`SitePolicy`)
 * must be able to say so in the route's type. `WidgetApiRoute` below is the
 * one-line production composition instead.
 *
 * `A`, `E` and `R` are all inferred from the argument: a bundle built over
 * `Database.PgliteDatabaseLive` drops the database requirement it replaces
 * rather than restating it, and one that leaves a dependency out simply leaves
 * it in the route's channel. Either way the route's requirements stay truthful.
 */
export const makeWidgetRoute = <A, E, R>({
  internals,
}: {
  readonly internals: Layer.Layer<A, E, R>;
}) =>
  HttpApiBuilder.layer(WidgetApi).pipe(
    Layer.provide(WidgetApiLive),
    Layer.provide(internals)
  );

/**
 * The `/api/widget/v1` route tree as production composes it.
 *
 * Its own `HttpApi` instance and its own route: the widget is the opposite
 * contract from the dashboard — cross-origin, session-less, embedded in
 * somebody else's page — so it is composed here rather than flattened into the
 * dashboard's `Api` and served by one `HttpApiBuilder.layer` for both. The
 * dashboard's document at `/docs/openapi.json` therefore describes the
 * dashboard only.
 *
 * Requires the services it shares with the rest of the server — the database,
 * the rate limiter, the plan decision, the site policy, `PostWriteService` and
 * `PostEmbeddingService` — so a layer dropped from
 * `apps/server/src/app/layers.ts` is a compose error rather than a
 * missing-service defect on a live request.
 */
export const WidgetApiRoute = makeWidgetRoute({
  internals: WidgetApiInternals,
});
