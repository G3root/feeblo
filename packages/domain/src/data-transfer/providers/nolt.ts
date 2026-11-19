import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";

import { parseCsvGrid } from "../csv";
import type { ParsedBoardPostRow } from "../csv";
import {
  DataImportProviderCredentialError,
  type DataImportProviderError,
  DataImportProviderEmptyError,
  DataImportProviderResponseError,
  DataImportRowLimitError,
} from "../errors";
import { DATA_IMPORT_MAX_BYTES, DATA_IMPORT_MAX_ROWS } from "../limits";
import type { ImportProviderAdapter, ProviderImportResult } from "../provider";
import type { TDataImportProviderDescriptor } from "../provider-schema";
import { executeProviderRequest, PROVIDER_LABELS } from "./http";

const NOLT_PROVIDER_ID = "nolt" as const;

/**
 * Nolt's API is an export, not a query API: a board exposes its posts as CSV
 * at `/api/csv` to a key created in the board's settings. The board host is
 * part of the credential because a key is scoped to exactly one board.
 */
const noltDescriptor: TDataImportProviderDescriptor = {
  carries: ["Posts and boards", "Statuses and votes", "Authors"],
  credentialFields: [
    {
      description: "For example acme.nolt.io, or just acme.",
      key: "boardUrl",
      label: "Nolt board URL",
      placeholder: "acme.nolt.io",
      secret: false,
    },
    {
      description:
        "Nolt board settings → APIs. The key is read once and never stored.",
      key: "apiKey",
      label: "Nolt API key",
      placeholder: "Paste your Nolt API key",
      secret: true,
    },
  ],
  helpText:
    "Create an API key in your Nolt board settings under APIs, then paste the board URL it belongs to.",
  helpUrl: "https://nolt.io",
  id: NOLT_PROVIDER_ID,
  name: PROVIDER_LABELS.nolt,
  omissions: [
    "Vote counts and comments are not imported.",
    "Nolt boards become boards here only when a post names them.",
  ],
  tagline:
    "Import a Nolt board's posts, keeping their boards, statuses and authors.",
};

/** A Nolt board host: `<board>.nolt.io`, optionally on the EU domain. */
const NOLT_HOST_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:eu\.)?nolt\.io$/u;

/**
 * Turns what a person types into the board's origin.
 *
 * Only a Nolt host is accepted: the key travels to the host this function
 * returns, so accepting an arbitrary URL would send a credential to whatever
 * the form was given.
 */
export const resolveNoltBoardOrigin = (
  raw: string
): Effect.Effect<string, DataImportProviderCredentialError> => {
  const value = raw.trim().toLowerCase();

  const withHost =
    /^[a-z0-9-]+$/u.test(value) && !value.includes(".")
      ? `${value}.nolt.io`
      : value;

  const parsed = (() => {
    try {
      return new URL(
        /^https?:\/\//u.test(withHost) ? withHost : `https://${withHost}`
      );
    } catch {
      return null;
    }
  })();

  if (parsed === null || !NOLT_HOST_PATTERN.test(parsed.hostname)) {
    return Effect.fail(
      new DataImportProviderCredentialError({
        message:
          "Enter your Nolt board URL, like acme.nolt.io. Only nolt.io boards can be imported.",
        provider: NOLT_PROVIDER_ID,
      })
    );
  }

  return Effect.succeed(`https://${parsed.hostname}`);
};

/** Lowercase and strip everything that is not a letter or digit. */
const normalizeHeader = (value: string): string =>
  value.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");

const HEADER_ALIASES = {
  authorEmail: ["authoremail", "email", "useremail", "createdbyemail"],
  authorName: ["authorname", "author", "username", "createdby"],
  board: ["board", "boardname"],
  content: ["content", "description", "details", "body", "text"],
  createdAt: ["createdat", "created", "date", "submittedat"],
  eta: ["eta", "roadmapeta", "targetdate"],
  id: ["id", "postid"],
  status: ["status", "state", "roadmapstatus"],
  tags: ["tags", "labels", "categories"],
  title: ["title", "posttitle", "name", "summary"],
  upvotes: ["upvotes", "votes", "votecount", "score"],
  url: ["url", "link", "permalink"],
} as const;

type NoltColumn = keyof typeof HEADER_ALIASES;

/**
 * The index of each column this adapter reads. The first alias present wins,
 * so a Nolt export with both `title` and `name` uses `title` in every row.
 */
const columnIndex = (
  header: readonly string[]
): Partial<Record<NoltColumn, number>> => {
  const byName = new Map<string, number>();

  header.forEach((cell, index) => {
    const name = normalizeHeader(cell);

    if (name.length > 0 && !byName.has(name)) {
      byName.set(name, index);
    }
  });

  const index: Partial<Record<NoltColumn, number>> = {};

  // SAFETY: `HEADER_ALIASES` is a literal object whose values are string
  // arrays, and `Object.entries` widens a literal key to `string`; the tuple
  // restores the key union this loop writes into `index`.
  for (const [column, aliases] of Object.entries(HEADER_ALIASES) as [
    NoltColumn,
    readonly string[],
  ][]) {
    for (const alias of aliases) {
      const found = byName.get(alias);

      if (found !== undefined) {
        index[column] = found;
        break;
      }
    }
  }

  return index;
};

/** Tags are one cell; Nolt writes them comma- or semicolon-separated. */
const splitTags = (value: string): readonly string[] =>
  value
    .split(/[;,]/u)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);

const toRows = (
  header: readonly string[],
  rows: readonly {
    readonly cells: readonly string[];
    readonly lineNumber: number;
  }[]
): readonly ParsedBoardPostRow[] => {
  const index = columnIndex(header);

  const value = (cells: readonly string[], column: NoltColumn): string => {
    const at = index[column];

    return at === undefined ? "" : (cells[at] ?? "").trim();
  };

  return rows.map((row) => ({
    authorEmail: value(row.cells, "authorEmail"),
    authorName: value(row.cells, "authorName"),
    board: value(row.cells, "board"),
    content: value(row.cells, "content"),
    createdAt: value(row.cells, "createdAt"),
    eta: value(row.cells, "eta"),
    rowNumber: row.lineNumber,
    status: value(row.cells, "status"),
    tags: splitTags(value(row.cells, "tags")),
    title: value(row.cells, "title"),
    updatedAt: "",
    url: value(row.cells, "url"),
    voteCount: value(row.cells, "upvotes"),
  }));
};

/**
 * Reads a response body while it streams, failing as soon as the bytes exceed
 * the import cap. The old `response.text` read the whole body first, so a
 * provider (or a proxy pretending to be one) could make the importer allocate
 * far past the limit before the check ran.
 */
const readBoundedBody = (
  response: HttpClientResponse.HttpClientResponse
): Effect.Effect<string, DataImportProviderError> =>
  Effect.gen(function* () {
    const entries = yield* response.stream.pipe(
      Stream.mapAccum(
        () => 0,
        (total, chunk) => {
          const next = total + chunk.byteLength;

          return [
            next,
            [{ chunk, exceeds: next > DATA_IMPORT_MAX_BYTES }],
          ] as const;
        }
      ),
      Stream.takeUntil((entry) => entry.exceeds),
      Stream.runCollect,
      Effect.mapError(
        () =>
          new DataImportProviderResponseError({
            cause: new Error("Nolt response body could not be read."),
            message:
              "Nolt returned a response this importer could not read. Check the key and try again.",
            provider: NOLT_PROVIDER_ID,
          })
      )
    );

    const collected = Array.from(entries);

    if (collected.at(-1)?.exceeds === true) {
      return yield* new DataImportProviderResponseError({
        message: `Nolt's export is larger than ${Math.round(
          DATA_IMPORT_MAX_BYTES / (1024 * 1024)
        )} MB. Import a smaller board or split it first.`,
        provider: NOLT_PROVIDER_ID,
      });
    }

    const bytes = new Uint8Array(
      collected.reduce((total, entry) => total + entry.chunk.byteLength, 0)
    );

    let offset = 0;

    for (const entry of collected) {
      bytes.set(entry.chunk, offset);
      offset += entry.chunk.byteLength;
    }

    return new TextDecoder("utf-8").decode(bytes);
  });

const makeNoltImportProvider = (options: {
  readonly httpClient?: HttpClient.HttpClient | undefined;
}): ImportProviderAdapter => {
  const clientLayer =
    options.httpClient === undefined
      ? FetchHttpClient.layer
      : Layer.succeed(HttpClient.HttpClient, options.httpClient);

  const fetchPosts = (input: {
    readonly credentials: Readonly<Record<string, string>>;
  }): Effect.Effect<
    ProviderImportResult,
    DataImportProviderError | DataImportRowLimitError
  > =>
    Effect.gen(function* () {
      const apiKey = input.credentials.apiKey?.trim() ?? "";
      const boardUrl = input.credentials.boardUrl?.trim() ?? "";

      if (apiKey.length === 0) {
        return yield* new DataImportProviderCredentialError({
          message: "Enter a Nolt API key.",
          provider: NOLT_PROVIDER_ID,
        });
      }

      if (boardUrl.length === 0) {
        return yield* new DataImportProviderCredentialError({
          message: "Enter your Nolt board URL, like acme.nolt.io.",
          provider: NOLT_PROVIDER_ID,
        });
      }

      const origin = yield* resolveNoltBoardOrigin(boardUrl);

      const response = yield* executeProviderRequest({
        label: PROVIDER_LABELS.nolt,
        provider: NOLT_PROVIDER_ID,
        request: HttpClientRequest.get(`${origin}/api/csv`).pipe(
          // Redacted values are sent unwrapped but stay redacted in
          // inspection, errors and client spans, so the key can stay in the
          // query string without reaching telemetry.
          HttpClientRequest.setUrlParam("apikey", Redacted.make(apiKey)),
          HttpClientRequest.accept("text/csv")
        ),
      });

      const text = yield* readBoundedBody(response);

      const grid = yield* parseCsvGrid(text).pipe(
        Effect.mapError(
          (error) =>
            new DataImportProviderResponseError({
              cause: error,
              message:
                "Nolt's export could not be read as CSV. Check the board URL and try again.",
              provider: NOLT_PROVIDER_ID,
            })
        )
      );

      if (grid.rows.length > DATA_IMPORT_MAX_ROWS) {
        return yield* new DataImportRowLimitError({
          maxRows: DATA_IMPORT_MAX_ROWS,
          message: `Nolt returned ${grid.rows.length} posts. The limit is ${DATA_IMPORT_MAX_ROWS}.`,
        });
      }

      const rows = toRows(grid.header, grid.rows);
      const index = columnIndex(grid.header);

      if (index.title === undefined) {
        return yield* new DataImportProviderResponseError({
          message:
            "Nolt's export has no title column, so it cannot be imported as posts.",
          provider: NOLT_PROVIDER_ID,
        });
      }

      if (rows.length === 0) {
        return yield* new DataImportProviderEmptyError({
          message:
            "This Nolt board has no posts to import. Check that the key belongs to the board you named.",
          provider: NOLT_PROVIDER_ID,
        });
      }

      const identity = (row: { readonly cells: readonly string[] }) =>
        index.id === undefined
          ? (row.cells[index.title ?? -1] ?? "").trim().toLowerCase()
          : (row.cells[index.id] ?? "").trim();

      return {
        fingerprint: [
          origin,
          ...grid.rows.map((row) => identity(row)).sort(),
        ].join("\n"),
        notices: [
          `Nolt returned ${rows.length} post${rows.length === 1 ? "" : "s"}.`,
          "Nolt vote counts and comments are not imported.",
        ],
        rows,
      };
    }).pipe(
      // The adapter is the bottom of the provider stack and pins its own HTTP
      // transport, the same boundary the other provider clients use. Tests
      // supply a fake through `makeNoltImportProvider` instead.
      // eslint-disable-next-line effecttsgo/strict-effect-provide -- provider client pins its transport
      Effect.provide(clientLayer)
    );

  return {
    descriptor: noltDescriptor,
    fetchPosts,
  };
};

/** The adapter the composition root registers; tests build one with a fake client. */
export const noltImportProvider = makeNoltImportProvider({});

export { makeNoltImportProvider };
