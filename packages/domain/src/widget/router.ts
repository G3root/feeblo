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
 * The `/api/widget/v1` route tree.
 *
 * Its own `HttpApi` instance and its own route: the widget is the opposite
 * contract from the dashboard — cross-origin, session-less, embedded in
 * somebody else's page — so it is composed here rather than flattened into the
 * dashboard's `Api` and served by one `HttpApiBuilder.layer` for both. The
 * dashboard's document at `/docs/openapi.json` therefore describes the
 * dashboard only.
 *
 * It needs no builder function the way `makePublicApiRoute` does: that one
 * takes the key middleware because a test composes the same route with a
 * smaller rate-limit budget, while the widget answers unauthenticated requests
 * and its rate limits are applied per handler against the request-scoped
 * `ClientIp`. A zero-argument wrapper around a `Layer` is indirection the
 * `effecttsgo/lazy-effect` rule rightly rejects.
 */
export const WidgetApiRoute = HttpApiBuilder.layer(WidgetApi).pipe(
  Layer.provide(WidgetApiLive),
  Layer.provide(WidgetApiInternals)
);
