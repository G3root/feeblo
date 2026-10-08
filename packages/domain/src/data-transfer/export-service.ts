import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { BoardRepository } from "../board/repository";
import * as Policy from "../policy";
import { statusDisplayName } from "../post-status/display-name";
import { PublicApiConfig } from "../public-api/config";
import { InternalServerError, withRemapDbErrors } from "../rpc-errors";
import {
  BOARD_POST_CSV_HEADER,
  type BoardPostCsvRow,
  serializeBoardPostCsvRows,
} from "./csv";
import {
  DataTransferBoardNotFoundError,
  DataExportTooLargeError,
  type DataTransferRepositoryError,
} from "./errors";
import { DATA_EXPORT_MAX_ROWS } from "./limits";
import { canExportData } from "./policies";
import { type PostCsvSourceRow, DataTransferRepository } from "./repository";

/** Posts read per database page while streaming. */
const EXPORT_PAGE_SIZE = 500;

const textEncoder = new TextEncoder();

const encodeText = (text: string): Uint8Array => textEncoder.encode(text);

/** Translates one store failure to the single internal failure callers see. */
const fromExportStore = <A, R>(
  effect: Effect.Effect<A, DataTransferRepositoryError, R>
): Effect.Effect<A, InternalServerError, R> =>
  effect.pipe(
    Effect.catchTag("DataTransferRepositoryError", () =>
      Effect.fail(
        new InternalServerError({
          message: "The export store is unavailable.",
        })
      )
    )
  );

type ExportCursor = { readonly createdAt: Date; readonly id: string };

const toCsvRow =
  ({
    appUrl,
    organizationId,
  }: {
    readonly appUrl: string;
    readonly organizationId: string;
  }) =>
  (row: PostCsvSourceRow): BoardPostCsvRow => ({
    authorEmail: row.authorEmail,
    authorName: row.authorName,
    board: row.boardName,
    content: row.content,
    createdAt: row.createdAt,
    eta: row.etaQuarter,
    status: statusDisplayName(row.statusLabel, row.statusType),
    tags: row.tags,
    title: row.title,
    updatedAt: row.updatedAt,
    url: [
      appUrl,
      encodeURIComponent(organizationId),
      "post",
      encodeURIComponent(row.boardSlug),
      encodeURIComponent(row.slug),
    ].join("/"),
    voteCount: row.voteCount,
  });

/**
 * Streams posts as CSV, either one board's or the whole workspace's.
 *
 * When a board is named, a missing one fails before anything else, so a stale
 * id reads as a 404 rather than an empty file. The row count is checked before
 * the first byte is produced, so "too large" is an ordinary error response
 * rather than a download that ends early. After that the stream pages the
 * selection by `(createdAt, id)`, reading each row's board, tags and vote
 * count per page; a database failure mid-stream aborts the response, which is
 * the only truthful thing left once headers are on the wire.
 */
export const streamPostCsv = (input: {
  readonly organizationId: string;
  /** A board to export, or null for every board in the workspace. */
  readonly boardId: string | null;
  readonly includeArchived: boolean;
}) =>
  Effect.gen(function* () {
    const repository = yield* DataTransferRepository;
    const boardRepository = yield* BoardRepository;
    const config = yield* PublicApiConfig;

    // A named board must exist, so a stale id reads as a 404 rather than an
    // empty file; an all-boards export skips the lookup entirely.
    let boardSlug: string | null = null;
    if (input.boardId !== null) {
      const found = yield* boardRepository
        .findByIdInOrganization({
          id: input.boardId,
          organizationId: input.organizationId,
        })
        .pipe(withRemapDbErrors("Board", "select"));
      if (Option.isNone(found)) {
        return yield* new DataTransferBoardNotFoundError({
          message: "No board with this id exists in this workspace.",
        });
      }
      boardSlug = found.value.slug;
    }

    const total = yield* fromExportStore(
      repository.countPostsForCsv({
        boardId: input.boardId,
        includeArchived: input.includeArchived,
        organizationId: input.organizationId,
      })
    );
    if (total > DATA_EXPORT_MAX_ROWS) {
      return yield* new DataExportTooLargeError({
        maxRows: DATA_EXPORT_MAX_ROWS,
        message: `This export has ${total} rows; the export limit is ${DATA_EXPORT_MAX_ROWS}. Narrow the export with the archived setting.`,
      });
    }

    const mapRow = toCsvRow({
      appUrl: config.appUrl,
      organizationId: input.organizationId,
    });

    const pages = Stream.paginate<
      ExportCursor | null,
      BoardPostCsvRow,
      InternalServerError
    >(null, (cursor) =>
      fromExportStore(
        repository.listPostCsvRows({
          after: cursor,
          boardId: input.boardId,
          includeArchived: input.includeArchived,
          limit: EXPORT_PAGE_SIZE,
          organizationId: input.organizationId,
        })
      ).pipe(
        Effect.map((page) => {
          const last = page.at(-1);
          const next =
            page.length === EXPORT_PAGE_SIZE && last !== undefined
              ? Option.some({ createdAt: last.createdAt, id: last.id })
              : Option.none<ExportCursor>();
          return [page.map(mapRow), next] as const;
        })
      )
    );

    const now = yield* DateTime.nowAsDate;
    const name = boardSlug === null ? "posts" : `${boardSlug}-posts`;
    return {
      fileName: `${name}-${now.toISOString().slice(0, 10)}.csv`,
      stream: Stream.concat(
        Stream.make(encodeText(BOARD_POST_CSV_HEADER)),
        pages.pipe(
          Stream.grouped(EXPORT_PAGE_SIZE),
          Stream.map((rows) => encodeText(serializeBoardPostCsvRows(rows)))
        )
      ),
    };
  }).pipe(Policy.withPolicy(canExportData(input.organizationId)));

/** What an export hands back: the download's name and its byte stream. */
export type PostCsvExport = Effect.Success<ReturnType<typeof streamPostCsv>>;
