import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";
import * as OpenApi from "effect/unstable/httpapi/OpenApi";

import type { PublicApiChangelogGroup } from "../../public-api/api-contract";
import {
  PUBLIC_API_CREATE_ERROR_SCHEMAS,
  PUBLIC_API_ERROR_SCHEMAS,
  PUBLIC_API_WRITE_ERROR_SCHEMAS,
} from "../../public-api/errors";
import { invalidRequestError } from "../../public-api/errors";
import type { HandlerOf } from "../../public-api/handler";
import { parseLimit } from "../../public-api/parse";
import {
  createChangelogOperation,
  deleteChangelogOperation,
  getChangelogOperation,
  listChangelogOperation,
  updateChangelogOperation,
} from "./operations";
import {
  CreateChangelogPayload,
  DeleteChangelogParams,
  GetChangelogParams,
  ListChangelogQuery,
  PublicApiChangelog,
  PublicApiChangelogPage,
  PublicApiChangelogStatus,
  UpdateChangelogParams,
  UpdateChangelogPayload,
} from "./schema";

/** The composed group, so a handler is typed with the group's middleware. */
type PublicApiGroup = InstanceType<typeof PublicApiChangelogGroup>;

/**
 * The `status` filter on the changelog list, or nothing for every status.
 *
 * Declared as a string in the query schema and decoded here, so a typo is the
 * documented `INVALID_REQUEST` rather than a page that silently looks empty.
 */
const parseChangelogStatusFilter = (raw: string | undefined) =>
  Effect.gen(function* () {
    if (raw === undefined || raw.length === 0) {
      return null;
    }

    const decoded = Schema.decodeUnknownOption(PublicApiChangelogStatus)(raw);
    if (Option.isNone(decoded)) {
      return yield* invalidRequestError(
        "status must be draft, scheduled, or published."
      );
    }

    return decoded.value;
  });

/** The changelog endpoints, and their HTTP implementations. */
export const changelogEndpoints = [
  HttpApiEndpoint.get("listChangelog", "/changelog", {
    query: ListChangelogQuery,
    success: PublicApiChangelogPage,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "List Changelog Entries")
    .annotate(OpenApi.Summary, "List the workspace's changelog entries")
    .annotate(
      OpenApi.Description,
      "Returns the changelog entries of the calling workspace, newest first, as a cursor-paginated page. Drafts and scheduled entries are included; pass status=published to list only what readers can already see."
    ),
  HttpApiEndpoint.get("getChangelog", "/changelog/:changelogId", {
    params: GetChangelogParams,
    success: PublicApiChangelog,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Get Changelog Entry")
    .annotate(OpenApi.Summary, "Get a changelog entry")
    .annotate(
      OpenApi.Description,
      "Returns one changelog entry with its sanitized body. Entries of other workspaces are reported as not found rather than forbidden, so an id cannot be used to probe another workspace."
    ),
  HttpApiEndpoint.post("createChangelog", "/changelog", {
    payload: CreateChangelogPayload,
    success: PublicApiChangelog.pipe(HttpApiSchema.status(201)),
    error: PUBLIC_API_CREATE_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Create Changelog Entry")
    .annotate(OpenApi.Summary, "Create a changelog entry")
    .annotate(
      OpenApi.Description,
      "Creates a changelog entry in the calling workspace and returns it. The entry is a draft unless the request says otherwise. Publishing it — status=published — additionally requires the changelog.publish scope, because it emails everyone subscribed to the workspace changelog."
    ),
  HttpApiEndpoint.patch("updateChangelog", "/changelog/:changelogId", {
    params: UpdateChangelogParams,
    payload: UpdateChangelogPayload,
    success: PublicApiChangelog,
    error: PUBLIC_API_WRITE_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Update Changelog Entry")
    .annotate(OpenApi.Summary, "Replace a changelog entry's writable fields")
    .annotate(
      OpenApi.Description,
      "Replaces the entry's title, slug, body, cover image, status, and timestamps, and returns the entry afterwards. The fields sent are the entry's new state. Moving an entry into published requires the changelog.publish scope, because it emails subscribers; editing an already-published entry does not."
    ),
  HttpApiEndpoint.delete("deleteChangelog", "/changelog/:changelogId", {
    params: DeleteChangelogParams,
    success: HttpApiSchema.NoContent,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Delete Changelog Entry")
    .annotate(OpenApi.Summary, "Delete a changelog entry")
    .annotate(
      OpenApi.Description,
      "Deletes a changelog entry and its links to the posts it announced. The entry is gone immediately and cannot be restored; the posts themselves are untouched."
    ),
] as const;

export const changelogHandlers = {
  listChangelog: (({ query }) =>
    Effect.gen(function* () {
      const limit = yield* parseLimit(query.limit);
      const status = yield* parseChangelogStatusFilter(query.status);
      return yield* listChangelogOperation.handler({
        cursor: query.cursor,
        limit,
        status: status ?? undefined,
      });
    })) satisfies HandlerOf<PublicApiGroup, "listChangelog">,

  getChangelog: (({ params }) =>
    getChangelogOperation.handler({
      changelogId: params.changelogId,
    })) satisfies HandlerOf<PublicApiGroup, "getChangelog">,

  createChangelog: (({ payload }) =>
    createChangelogOperation.handler(payload)) satisfies HandlerOf<
    PublicApiGroup,
    "createChangelog"
  >,

  updateChangelog: (({ params, payload }) =>
    updateChangelogOperation.handler({
      ...payload,
      changelogId: params.changelogId,
    })) satisfies HandlerOf<PublicApiGroup, "updateChangelog">,

  deleteChangelog: (({ params }) =>
    deleteChangelogOperation.handler({
      changelogId: params.changelogId,
    })) satisfies HandlerOf<PublicApiGroup, "deleteChangelog">,
};
