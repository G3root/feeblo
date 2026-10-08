import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiSchema from "effect/http-api/HttpApiSchema";
import * as OpenApi from "effect/http-api/OpenApi";

import type { PublicApiCompanyGroup } from "../../public-api/api-contract";
import {
  PUBLIC_API_CREATE_ERROR_SCHEMAS,
  PUBLIC_API_ERROR_SCHEMAS,
  PUBLIC_API_WRITE_ERROR_SCHEMAS,
} from "../../public-api/errors";
import type { HandlerOf } from "../../public-api/handler";
import type { PublicApiCaller } from "../../public-api/middleware";
import type { PublicApiDependencies } from "../../public-api/operations";
import { parseLimit } from "../../public-api/parse";
import {
  createCompanyOperation,
  deleteCompanyOperation,
  getCompanyOperation,
  listCompaniesOperation,
  updateCompanyOperation,
} from "./operations";
import {
  CreateCompanyPayload,
  DeleteCompanyParams,
  GetCompanyParams,
  ListCompaniesQuery,
  PublicApiCompany,
  PublicApiCompanyPage,
  UpdateCompanyParams,
  UpdateCompanyPayload,
} from "./schema";

/** The composed group, so a handler is typed with the group's middleware. */
type PublicApiGroup = InstanceType<typeof PublicApiCompanyGroup>;

/** The company endpoints, and their HTTP implementations. */
export const companyEndpoints = [
  HttpApiEndpoint.get("listCompanies", "/companies", {
    query: ListCompaniesQuery,
    success: PublicApiCompanyPage,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "List Companies")
    .annotate(OpenApi.Summary, "List the workspace's companies")
    .annotate(
      OpenApi.Description,
      "Returns the companies of the calling workspace, newest first, as a cursor-paginated page. A company is an account record; the contacts who belong to it are not returned, and neither are the workspace's custom attribute values."
    ),
  HttpApiEndpoint.post("createCompany", "/companies", {
    payload: CreateCompanyPayload,
    success: PublicApiCompany.pipe(HttpApiSchema.status(201)),
    error: PUBLIC_API_CREATE_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Create Company")
    .annotate(OpenApi.Summary, "Create a company")
    .annotate(
      OpenApi.Description,
      "Creates a company in the calling workspace and returns it. The name is trimmed, the id is minted by the server, and the company is recorded with the API as its source. A name, or an externalId, already used in the workspace is reported as a conflict rather than creating a second record for the same account."
    ),
  HttpApiEndpoint.get("getCompany", "/companies/:companyId", {
    params: GetCompanyParams,
    success: PublicApiCompany,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Get Company")
    .annotate(OpenApi.Summary, "Get a company")
    .annotate(
      OpenApi.Description,
      "Returns one company. Companies of other workspaces are reported as not found rather than forbidden, so an id cannot be used to probe another workspace."
    ),
  HttpApiEndpoint.patch("updateCompany", "/companies/:companyId", {
    params: UpdateCompanyParams,
    payload: UpdateCompanyPayload,
    success: PublicApiCompany,
    error: PUBLIC_API_WRITE_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Update Company")
    .annotate(OpenApi.Summary, "Update a company")
    .annotate(
      OpenApi.Description,
      "Updates the fields the request names and returns the company afterwards. An omitted field is left as it is and an explicit null clears a nullable one. A body that names no field is rejected as an invalid request, and a name or externalId another company in the workspace already holds is reported as a conflict."
    ),
  HttpApiEndpoint.delete("deleteCompany", "/companies/:companyId", {
    params: DeleteCompanyParams,
    success: HttpApiSchema.NoContent,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Delete Company")
    .annotate(OpenApi.Summary, "Delete a company")
    .annotate(
      OpenApi.Description,
      "Deletes a company and detaches it from the contacts that belonged to it. The contacts themselves are untouched and keep their own records; the company cannot be restored."
    ),
] as const;

export const companyHandlers = (
  context: Context.Context<PublicApiDependencies>
) => ({
  listCompanies: (({ query }) =>
    Effect.gen(function* () {
      const limit = yield* parseLimit(query.limit);
      return yield* listCompaniesOperation.handler({
        cursor: query.cursor,
        limit,
      });
    }).pipe(Effect.provideContext(context))) satisfies HandlerOf<
    PublicApiGroup,
    "listCompanies",
    PublicApiCaller
  >,

  // The body is the operation's own input minus the path, so handing it over
  // cannot drop a field the operation gains.
  createCompany: (({ payload }) =>
    createCompanyOperation
      .handler(payload)
      .pipe(Effect.provideContext(context))) satisfies HandlerOf<
    PublicApiGroup,
    "createCompany",
    PublicApiCaller
  >,

  // The URL's params are the operation's own input fields, so handing them
  // over cannot drop a field the operation gains.
  getCompany: (({ params }) =>
    getCompanyOperation
      .handler(params)
      .pipe(Effect.provideContext(context))) satisfies HandlerOf<
    PublicApiGroup,
    "getCompany",
    PublicApiCaller
  >,

  updateCompany: (({ params, payload }) =>
    updateCompanyOperation
      .handler({
        ...payload,
        ...params,
      })
      .pipe(Effect.provideContext(context))) satisfies HandlerOf<
    PublicApiGroup,
    "updateCompany",
    PublicApiCaller
  >,

  deleteCompany: (({ params }) =>
    deleteCompanyOperation
      .handler(params)
      .pipe(Effect.provideContext(context))) satisfies HandlerOf<
    PublicApiGroup,
    "deleteCompany",
    PublicApiCaller
  >,
});
