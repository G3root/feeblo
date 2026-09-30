import { changelogOperations } from "../changelog/public-api/operations";
import { commentOperations } from "../comments/public-api/operations";
import { companyOperations } from "../company/public-api/operations";
import { postOperations } from "../post/public-api/operations";
import { tagOperations } from "../tag/public-api/operations";

/**
 * Every Public API operation, in one registry.
 *
 * This is the list a non-HTTP surface iterates. The HTTP projection in
 * `api-contract.ts`/`api-live.ts` composes the same per-resource arrays, so the
 * two cannot cover different sets: a resource added to one is a line here and
 * there, and a test (`operations.test.ts`) asserts the registry and the
 * published endpoints name the same operations.
 *
 * A future MCP server derives its tools from this list — name, description,
 * typed input and output schemas, scope, and annotations are all on the
 * operation — and binds them to the same handlers the HTTP endpoints call, so
 * the two surfaces cannot drift into different answers for the same call. See
 * `docs/adr/0007`.
 */
export const PublicApiOperations = [
  ...changelogOperations,
  ...commentOperations,
  ...companyOperations,
  ...postOperations,
  ...tagOperations,
] as const;

export type PublicApiOperationName =
  (typeof PublicApiOperations)[number]["name"];
