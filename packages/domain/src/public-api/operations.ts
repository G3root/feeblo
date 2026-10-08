import type * as Effect from "effect/Effect";

import { boardOperations } from "../board/public-api/operations";
import { changelogOperations } from "../changelog/public-api/operations";
import { commentOperations } from "../comments/public-api/operations";
import { companyOperations } from "../company/public-api/operations";
import { endUserOperations } from "../contact/public-api/operations";
import { statusOperations } from "../post-status/public-api/operations";
import { postOperations } from "../post/public-api/operations";
import { tagOperations } from "../tag/public-api/operations";
import { voteOperations } from "../upvote/public-api/operations";
import type { PublicApiCaller } from "./middleware";

/**
 * Every Public API operation, in one registry.
 *
 * This is the list a non-HTTP surface iterates. The HTTP projection in
 * `api-contract.ts`/`api-live.ts` composes the same per-resource arrays, so the
 * two cannot cover different sets: a resource added to one is a line here and
 * there, and a test (`operations.test.ts`) asserts the registry and the
 * published endpoints name the same operations.
 *
 * The MCP surface (`mcp.ts`) derives its toolkit from this list — name,
 * description, typed input and output schemas, scope, and annotations are all
 * on the operation — and binds it to the same handlers the HTTP endpoints call,
 * so the two surfaces cannot drift into different answers for the same call.
 * See `docs/adr/0007` and `docs/adr/0008`.
 */
export const PublicApiOperations = [
  ...boardOperations,
  ...changelogOperations,
  ...commentOperations,
  ...companyOperations,
  ...endUserOperations,
  ...postOperations,
  ...statusOperations,
  ...tagOperations,
  ...voteOperations,
] as const;

export type PublicApiOperationName =
  (typeof PublicApiOperations)[number]["name"];

type OperationRequirements<Operation> = Operation extends {
  readonly handler: (
    input: never
  ) => Effect.Effect<infer _A, infer _E, infer Requirements>;
}
  ? Requirements
  : never;

/**
 * The stable services every registered operation reads from the context.
 *
 * `PublicApiCaller` is excluded: it is request-scoped, provided per request by
 * the key middleware, so a handler that yields it is a middleware consumer
 * rather than a layer requirement. Everything else — the feature repositories,
 * the public projections, the application URL, the database handle, the plan
 * decision — is built once and captured when a surface composes its groups, so
 * a missing layer fails that surface's type instead of one request.
 */
export type PublicApiDependencies = Exclude<
  OperationRequirements<(typeof PublicApiOperations)[number]>,
  PublicApiCaller
>;
