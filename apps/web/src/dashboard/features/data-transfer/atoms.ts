import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";
import * as Stream from "effect/Stream";

import { DashboardClient, dashboardSWR } from "~/lib/atom-rpc";

/** The boards the export picker can name, read once for the card. */
export const dataTransferBoardsAtom = Atom.family((organizationId: string) =>
  DashboardClient.query("BoardList", { organizationId }).pipe(
    dashboardSWR("30 seconds"),
    Atom.setIdleTTL("5 minutes")
  )
);

/** One board a picker may name. */
export type DataTransferBoard = Atom.Success<
  ReturnType<typeof dataTransferBoardsAtom>
>[number];

/**
 * The workspace's import jobs, newest first.
 *
 * This is a watch RPC rather than a query: the server re-reads the list on an
 * interval and pushes only snapshots that changed, so a running import's
 * counters move without the page polling. The stream stays open — another
 * upload can arrive at any time.
 */
export const dataImportJobsAtom = Atom.family((organizationId: string) =>
  DashboardClient.runtime.atom(
    Stream.unwrap(
      DashboardClient.use((client) =>
        Effect.succeed(client("DataImportListWatch", { organizationId }))
      )
    )
  )
);

export type DataImportDetailArgs = {
  readonly id: string;
  readonly limit: number;
  readonly offset: number;
  readonly organizationId: string;
};

/**
 * One import job plus the report page being viewed.
 *
 * The watch RPC ends once the job reaches a terminal status, so the atom
 * holds the final snapshot and the page stops re-rendering without any
 * client-side stop condition.
 */
export const dataImportDetailAtom = Atom.family((args: DataImportDetailArgs) =>
  DashboardClient.runtime.atom(
    Stream.unwrap(
      DashboardClient.use((client) =>
        Effect.succeed(
          client("DataImportWatch", {
            id: args.id,
            limit: args.limit,
            offset: args.offset,
            organizationId: args.organizationId,
          })
        )
      )
    )
  )
);

export const confirmDataImportAtom =
  DashboardClient.mutation("DataImportConfirm");
export const cancelDataImportAtom =
  DashboardClient.mutation("DataImportCancel");
