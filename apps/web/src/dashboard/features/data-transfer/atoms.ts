import type {
  TDataImportRowFilter,
  TDataImportRowSort,
} from "@feeblo/domain/data-transfer/schema";
import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";
import * as Stream from "effect/Stream";

import { DashboardClient, dashboardSWR } from "~/lib/atom-rpc";

/** The boards the export picker can name, read once for the card. */
export const dataTransferBoardsAtom = Atom.family((organizationId: string) =>
  DashboardClient.query("ListBoards", { organizationId }).pipe(
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
        Effect.succeed(client("WatchDataImports", { organizationId }))
      )
    )
  )
);

export type DataImportDetailArgs = {
  readonly id: string;
  readonly limit: number;
  readonly offset: number;
  readonly organizationId: string;
  /** Absent narrows nothing; the filter replaces the old whole-job view. */
  readonly filter: TDataImportRowFilter | null;
  readonly board: string | null;
  readonly message: string | null;
  readonly sort: TDataImportRowSort;
};

/**
 * One import job plus the report page being viewed.
 *
 * The watch RPC ends once the job reaches a terminal status, so the atom
 * holds the final snapshot and the page stops re-rendering without any
 * client-side stop condition. Filters are part of the atom key, so changing
 * one opens the stream for that view instead of re-sorting in the browser.
 */
export const dataImportDetailAtom = Atom.family(
  (args: DataImportDetailArgs) => {
    const window = {
      id: args.id,
      limit: args.limit,
      offset: args.offset,
      organizationId: args.organizationId,
      sort: args.sort,
    };
    // Optional keys are added one at a time: the RPC payload type refuses an
    // explicit `undefined`, and a key that is present must carry a real value.
    const withFilter =
      args.filter === null ? window : { ...window, filter: args.filter };
    const withBoard =
      args.board === null ? withFilter : { ...withFilter, board: args.board };
    const payload =
      args.message === null
        ? withBoard
        : { ...withBoard, message: args.message };
    return DashboardClient.runtime.atom(
      Stream.unwrap(
        DashboardClient.use((client) =>
          Effect.succeed(client("WatchDataImport", payload))
        )
      )
    );
  }
);

export const confirmDataImportAtom =
  DashboardClient.mutation("ConfirmDataImport");
export const cancelDataImportAtom =
  DashboardClient.mutation("CancelDataImport");
