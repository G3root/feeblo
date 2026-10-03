import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { currentPostStatusRepository } from "../../post-status/repository";
import { InternalError } from "../../public-api/errors";
import { onInternalError } from "../../public-api/failure";
import { currentPublicApiCaller } from "../../public-api/middleware";
import { defineOperation } from "../../public-api/operation";
import { withRemapDbErrors } from "../../rpc-errors";
import { toPublicApiStatusDetail, toStatusSource } from "./mappers";
import { ListStatusesInput, PublicApiStatusList } from "./schema";

/** The read vocabulary: a status read has no input and nothing to collide with. */
const STATUS_READ_FAILURES = Schema.Union([InternalError]);

/**
 * The status operations.
 *
 * A caller that creates a post has to name a `statusId`, and until now the only
 * way to learn one was to read a post and copy the status it happened to carry.
 * The catalog is the workspace's own — a workspace may rename and reorder its
 * statuses — so it cannot be hard-coded by an integration.
 *
 * The scope is `posts.read`: a status only describes a post, so a key that may
 * read posts may read the vocabulary they are filed under. A key that only
 * reads tags or the changelog does not learn it.
 */
export const listStatusesOperation = defineOperation(
  "listStatuses",
  {
    annotations: { idempotent: true, readOnly: true },
    description:
      "List the workspace's post statuses in display order. The list is complete rather than paginated: a workspace has a handful of statuses, ordered by the workspace's own `orderIndex` rather than by age.",
    failure: STATUS_READ_FAILURES,
    input: ListStatusesInput,
    output: PublicApiStatusList,
    scope: "posts.read",
  },
  () =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const statuses = yield* currentPostStatusRepository;

      const rows = yield* statuses
        .findMany({ organizationId: caller.organizationId })
        .pipe(
          withRemapDbErrors("PublicApiPostStatus", "select"),
          Effect.catchTag("InternalServerError", () => onInternalError)
        );

      return {
        data: rows.map((row) => toPublicApiStatusDetail(toStatusSource(row))),
      };
    })
);

export const statusOperations = [listStatusesOperation] as const;
