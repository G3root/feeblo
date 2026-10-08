import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as OpenApi from "effect/http-api/OpenApi";

import type { PublicApiEndUserGroup } from "../../public-api/api-contract";
import {
  PUBLIC_API_CREATE_ERROR_SCHEMAS,
  PUBLIC_API_ERROR_SCHEMAS,
} from "../../public-api/errors";
import type { HandlerOf } from "../../public-api/handler";
import type { PublicApiCaller } from "../../public-api/middleware";
import type { PublicApiDependencies } from "../../public-api/operations";
import { parseLimit, providedQueryParam } from "../../public-api/parse";
import {
  getEndUserOperation,
  listEndUsersOperation,
  upsertEndUserOperation,
} from "./operations";
import {
  GetEndUserParams,
  ListEndUsersQuery,
  PublicApiEndUser,
  PublicApiEndUserPage,
  UpsertEndUserPayload,
} from "./schema";

/** The composed group, so a handler is typed with the group's middleware. */
type PublicApiGroup = InstanceType<typeof PublicApiEndUserGroup>;

/** The end-user endpoints, and their HTTP implementations. */
export const endUserEndpoints = [
  HttpApiEndpoint.get("listEndUsers", "/end-users", {
    query: ListEndUsersQuery,
    success: PublicApiEndUserPage,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "List End Users")
    .annotate(OpenApi.Summary, "List the workspace's end users")
    .annotate(
      OpenApi.Description,
      "Returns the workspace's end users — its own records of its customers — newest first, as a cursor-paginated page. `externalId`, `email`, and `companyId` narrow it. An end user carries the contact id, the caller's own external id, the display name and avatar, and the company it belongs to; the email address and the account behind the record are never returned."
    ),
  HttpApiEndpoint.get("getEndUser", "/end-users/:endUserId", {
    params: GetEndUserParams,
    success: PublicApiEndUser,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Get End User")
    .annotate(OpenApi.Summary, "Get an end user")
    .annotate(
      OpenApi.Description,
      "Returns one end user by the contact id the list returns. An end user of another workspace is reported as not found rather than forbidden, so an id cannot be used to probe another workspace."
    ),
  HttpApiEndpoint.post("upsertEndUser", "/end-users", {
    payload: UpsertEndUserPayload,
    success: PublicApiEndUser,
    // The create vocabulary, which publishes the conflict an upsert can
    // answer and no `404`: an upsert never reports a missing resource — the
    // resource is what it makes when it finds none.
    error: PUBLIC_API_CREATE_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Create or Update End User")
    .annotate(OpenApi.Summary, "Create or update an end user")
    .annotate(
      OpenApi.Description,
      "Creates the end user if the externalId or email names nobody, and updates the one it names otherwise — so a sync can run twice without making a second person. At least one of `externalId` and `email` is required. An absent field is left alone and an explicit null clears a nullable one; a `companyId` that does not exist in the workspace is an invalid request, and an externalId or email that already belongs to a different end user is reported as a conflict rather than reassigned. A record created here is the customer a later post, comment, or vote on their behalf attaches to."
    ),
] as const;

export const endUserHandlers = (
  context: Context.Context<PublicApiDependencies>
) => ({
  listEndUsers: (({ query }) =>
    Effect.gen(function* () {
      const limit = yield* parseLimit(query.limit);
      return yield* listEndUsersOperation.handler({
        companyId: providedQueryParam(query.companyId),
        cursor: query.cursor,
        email: providedQueryParam(query.email),
        externalId: providedQueryParam(query.externalId),
        limit,
      });
    }).pipe(Effect.provideContext(context))) satisfies HandlerOf<
    PublicApiGroup,
    "listEndUsers",
    PublicApiCaller
  >,

  // The URL's params are the operation's own input fields, so handing them
  // over cannot drop a field the operation gains.
  getEndUser: (({ params }) =>
    getEndUserOperation
      .handler(params)
      .pipe(Effect.provideContext(context))) satisfies HandlerOf<
    PublicApiGroup,
    "getEndUser",
    PublicApiCaller
  >,

  // The body is the operation's own input, so handing it over cannot drop a
  // field the operation gains.
  upsertEndUser: (({ payload }) =>
    upsertEndUserOperation
      .handler(payload)
      .pipe(Effect.provideContext(context))) satisfies HandlerOf<
    PublicApiGroup,
    "upsertEndUser",
    PublicApiCaller
  >,
});
