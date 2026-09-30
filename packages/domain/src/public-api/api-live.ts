import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { changelogHandlers } from "../changelog/public-api/http";
import { commentHandlers } from "../comments/public-api/http";
import { companyHandlers } from "../company/public-api/http";
import { postHandlers } from "../post/public-api/http";
import { tagHandlers } from "../tag/public-api/http";
import { PublicApi } from "./api-contract";

/**
 * The HTTP implementations of every Public API endpoint.
 *
 * One record per resource, merged here. A handler added to `post` is an edit
 * to `post/http.ts` and nothing else, so two changes to different resources do
 * not collide in this file; a whole resource is the one line below that names
 * it. Each handler parses its HTTP input and delegates to an operation in that
 * resource's `operations.ts`, which is the same code an MCP tool or a CLI
 * would call.
 */
export const PublicApiLive = HttpApiBuilder.group(
  PublicApi,
  "PublicApiV1",
  (handlers) =>
    handlers.handleAll({
      ...changelogHandlers,
      ...commentHandlers,
      ...companyHandlers,
      ...postHandlers,
      ...tagHandlers,
    })
);
