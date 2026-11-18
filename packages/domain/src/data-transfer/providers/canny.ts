import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Headers from "effect/http/Headers";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import type { ParsedBoardPostRow } from "../csv";
import {
  type DataImportProviderError,
  DataImportProviderCredentialError,
  DataImportProviderEmptyError,
  DataImportProviderRateLimitedError,
  DataImportProviderResponseError,
  DataImportProviderUnavailableError,
  DataImportRowLimitError,
} from "../errors";
import { DATA_IMPORT_MAX_ROWS } from "../limits";
import type { ImportProviderAdapter, ProviderImportResult } from "../provider";
import type { TDataImportProviderDescriptor } from "../provider-schema";

/** Canny's public API origin; every endpoint is a form-encoded POST. */
const CANNY_API_BASE_URL = "https://canny.io/api/v1";

/** Canny's maximum page size for `posts/list`. */
const CANNY_PAGE_SIZE = 100;

/** One transport retry, so a single reset does not fail a long import. */
const CANNY_TRANSPORT_RETRY_DELAY = "250 millis";

const CANNY_PROVIDER_ID = "canny" as const;

/**
 * The status labels a Canny post maps onto.
 *
 * Canny's own vocabulary is close to this workspace vocabulary but not equal:
 * `open` is this product's `Pending`, and `complete` is `Completed`. Mapping
 * here means an ordinary Canny board imports without a warning per post. A
 * custom Canny status is passed through unchanged so the planner can still
 * match a workspace status the team named the same way.
 */
const CANNY_STATUS_LABELS = new Map([
  ["closed", "Closed"],
  ["complete", "Completed"],
  ["in progress", "In Progress"],
  ["open", "Pending"],
  ["planned", "Planned"],
  ["under review", "Review"],
]);

const MONTHS = new Map([
  ["april", 4],
  ["aug", 8],
  ["august", 8],
  ["dec", 12],
  ["december", 12],
  ["feb", 2],
  ["february", 2],
  ["jan", 1],
  ["january", 1],
  ["jul", 7],
  ["july", 7],
  ["jun", 6],
  ["june", 6],
  ["mar", 3],
  ["march", 3],
  ["may", 5],
  ["nov", 11],
  ["november", 11],
  ["oct", 10],
  ["october", 10],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
]);

const QUARTER_YEAR_PATTERN = /^(\d{4})-q([1-4])$/iu;

const YEAR_QUARTER_PATTERN = /^q([1-4])\s+(\d{4})$/iu;

const MONTH_YEAR_PATTERN = /^([a-z]+)\.?\s+(\d{4})$/iu;

const CannyBoard = Schema.Struct({ name: Schema.String });

const CannyAuthor = Schema.Struct({
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  email: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const CannyTag = Schema.Struct({ name: Schema.String });

const CannyPost = Schema.Struct({
  id: Schema.String,
  // Title and creation time are optional so one malformed post is a failed
  // row the report explains, not a decode failure that discards the pull.
  title: Schema.optionalKey(Schema.String),
  board: Schema.optionalKey(Schema.NullOr(CannyBoard)),
  author: Schema.optionalKey(Schema.NullOr(CannyAuthor)),
  created: Schema.optionalKey(Schema.String),
  details: Schema.optionalKey(Schema.NullOr(Schema.String)),
  eta: Schema.optionalKey(Schema.NullOr(Schema.String)),
  score: Schema.optionalKey(Schema.Finite),
  status: Schema.optionalKey(Schema.NullOr(Schema.String)),
  tags: Schema.optionalKey(Schema.Array(CannyTag)),
  url: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const CannyPostsPage = Schema.Struct({
  posts: Schema.Array(CannyPost),
  hasMore: Schema.optionalKey(Schema.Boolean),
});

type CannyPost = Schema.Schema.Type<typeof CannyPost>;

/**
 * The descriptor the dashboard renders. The help link is Canny's own API-key
 * settings page, so the person does not have to search for where a key lives.
 */
const cannyDescriptor: TDataImportProviderDescriptor = {
  carries: ["Posts and boards", "Statuses, tags and etas", "Authors"],
  credentialFields: [
    {
      description:
        "Canny → Settings → API. The key is read once and never stored.",
      key: "apiKey",
      label: "Canny API key",
      placeholder: "Paste your Canny API key",
      secret: true,
    },
  ],
  helpText:
    "Find the key in Canny under Settings → API. It needs permission to read posts.",
  helpUrl: "https://canny.io/admin/settings/api",
  id: CANNY_PROVIDER_ID,
  name: "Canny",
  omissions: [
    "Vote counts, comments and categories are not imported.",
    "Original Canny post links are not kept.",
  ],
  tagline:
    "Import every post Canny can see, keeping boards, statuses, tags and authors.",
};

/** Canny's `February 2020` / `Q1 2020` / `2020-Q1` eta as this product's quarter. */
const parseCannyEta = (value: string | null): string => {
  if (value === null) {
    return "";
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return "";
  }

  const quarterYear = QUARTER_YEAR_PATTERN.exec(trimmed);

  if (quarterYear !== null) {
    return `${quarterYear[1] ?? ""}-Q${quarterYear[2] ?? ""}`.toUpperCase();
  }

  const yearQuarter = YEAR_QUARTER_PATTERN.exec(trimmed);

  if (yearQuarter !== null) {
    return `${yearQuarter[2] ?? ""}-Q${yearQuarter[1] ?? ""}`.toUpperCase();
  }

  const monthYear = MONTH_YEAR_PATTERN.exec(trimmed);

  if (monthYear !== null) {
    const month = MONTHS.get((monthYear[1] ?? "").toLowerCase());

    if (month !== undefined) {
      return `${monthYear[2] ?? ""}-Q${Math.ceil(month / 3)}`;
    }
  }

  // Not a shape this importer understands. Return it unchanged so the
  // planner's warning names the value and leaves the eta empty, instead of
  // silently dropping a date the team can still see in Canny.
  return trimmed;
};

const mapCannyStatus = (value: string | null): string => {
  const trimmed = value?.trim() ?? "";

  if (trimmed.length === 0) {
    return "";
  }

  return CANNY_STATUS_LABELS.get(trimmed.toLowerCase()) ?? trimmed;
};

const toPostRow = (post: CannyPost, index: number): ParsedBoardPostRow => ({
  authorEmail: (post.author?.email ?? "").trim().toLowerCase(),
  authorName: (post.author?.name ?? "").trim(),
  board: post.board?.name ?? "",
  content: post.details ?? "",
  createdAt: post.created ?? "",
  eta: parseCannyEta(post.eta ?? null),
  // The planner ignores the vote and URL columns; Canny's score is kept here
  // only so the row shape stays the parser's, not a second row contract.
  rowNumber: index + 1,
  status: mapCannyStatus(post.status ?? null),
  tags: (post.tags ?? []).map((tag) => tag.name),
  title: post.title ?? "",
  updatedAt: "",
  url: post.url ?? "",
  voteCount: String(post.score ?? 0),
});

const retryAfterSeconds = (response: HttpClientResponse.HttpClientResponse) =>
  Option.match(Headers.get(response.headers, "retry-after"), {
    onNone: () => null,
    onSome: (value) => {
      const seconds = Number.parseInt(value.trim(), 10);

      return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
    },
  });

const rateLimitMessage = (seconds: number | null): string => {
  if (seconds === null) {
    return "Canny is rate limiting this API key. Wait a few minutes, then start the import again.";
  }

  const wait =
    seconds < 60
      ? `${seconds} second${seconds === 1 ? "" : "s"}`
      : `${Math.ceil(seconds / 60)} minute${seconds <= 60 ? "" : "s"}`;

  return `Canny is rate limiting this API key. Try again in about ${wait}.`;
};

const makeCannyImportProvider = (options: {
  readonly httpClient?: HttpClient.HttpClient | undefined;
}): ImportProviderAdapter => {
  const clientLayer =
    options.httpClient === undefined
      ? FetchHttpClient.layer
      : Layer.succeed(HttpClient.HttpClient, options.httpClient);

  const fetchPage = (apiKey: string, skip: number) =>
    Effect.gen(function* () {
      const request = HttpClientRequest.post(
        `${CANNY_API_BASE_URL}/posts/list`
      ).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bodyUrlParams({
          apiKey,
          limit: CANNY_PAGE_SIZE,
          skip,
          sort: "newest",
        })
      );

      const response = yield* HttpClient.execute(request).pipe(
        // A reset or a dropped connection is worth one more attempt; an HTTP
        // status is not retried here because Canny's `Retry-After` can be an
        // hour, and an RPC must not sit on it.
        Effect.retry({
          schedule: Schedule.exponential(CANNY_TRANSPORT_RETRY_DELAY),
          times: 1,
        }),
        Effect.mapError(
          (_error) =>
            new DataImportProviderUnavailableError({
              cause: new Error("Canny request failed."),
              message:
                "Canny could not be reached. Check the connection and try again.",
              provider: CANNY_PROVIDER_ID,
            })
        )
      );

      if (response.status === 401 || response.status === 403) {
        return yield* new DataImportProviderCredentialError({
          message:
            "Canny rejected the API key. Check that the key is correct and can read posts.",
          provider: CANNY_PROVIDER_ID,
        });
      }

      if (response.status === 429) {
        const retryAfter = retryAfterSeconds(response);

        return yield* new DataImportProviderRateLimitedError({
          message: rateLimitMessage(retryAfter),
          provider: CANNY_PROVIDER_ID,
          retryAfterSeconds: retryAfter,
        });
      }

      if (response.status >= 500) {
        return yield* new DataImportProviderUnavailableError({
          message: "Canny is having trouble right now. Try again later.",
          provider: CANNY_PROVIDER_ID,
        });
      }

      if (response.status < 200 || response.status >= 300) {
        return yield* new DataImportProviderResponseError({
          message:
            "Canny did not accept the posts request. Check that the key belongs to the right Canny workspace.",
          provider: CANNY_PROVIDER_ID,
        });
      }

      return yield* HttpClientResponse.schemaBodyJson(CannyPostsPage)(
        response
      ).pipe(
        Effect.mapError(
          (_error) =>
            new DataImportProviderResponseError({
              cause: new Error("Canny response could not be read."),
              message:
                "Canny returned a response this importer could not read. Try again, or contact support if it keeps happening.",
              provider: CANNY_PROVIDER_ID,
            })
        )
      );
    });

  const fetchAllPosts = Effect.fnUntraced(function* (apiKey: string) {
    const posts: CannyPost[] = [];
    let skip = 0;

    for (;;) {
      const page = yield* fetchPage(apiKey, skip);
      posts.push(...page.posts);

      if (posts.length > DATA_IMPORT_MAX_ROWS) {
        return yield* new DataImportRowLimitError({
          maxRows: DATA_IMPORT_MAX_ROWS,
          message: `Canny returned more than ${DATA_IMPORT_MAX_ROWS} posts. The limit is ${DATA_IMPORT_MAX_ROWS}.`,
        });
      }

      // `hasMore` is the documented stop. The page-length check covers a
      // response that omits it and a provider that caps a page below the
      // limit, so neither can loop forever.
      if (page.hasMore === false || page.posts.length < CANNY_PAGE_SIZE) {
        break;
      }

      skip += CANNY_PAGE_SIZE;
    }

    return posts;
  });

  const fetchPosts = (input: {
    readonly credentials: Readonly<Record<string, string>>;
  }): Effect.Effect<
    ProviderImportResult,
    DataImportProviderError | DataImportRowLimitError
  > =>
    Effect.gen(function* () {
      const apiKey = input.credentials.apiKey?.trim() ?? "";

      if (apiKey.length === 0) {
        return yield* new DataImportProviderCredentialError({
          message: "Enter a Canny API key.",
          provider: CANNY_PROVIDER_ID,
        });
      }

      const posts = yield* fetchAllPosts(apiKey);

      if (posts.length === 0) {
        return yield* new DataImportProviderEmptyError({
          message:
            "The Canny API key can see no posts. Check that it belongs to the Canny workspace you want to import.",
          provider: CANNY_PROVIDER_ID,
        });
      }

      return {
        fingerprint: posts
          .map((post) => post.id)
          .sort()
          .join("\n"),
        notices: [
          `Canny returned ${posts.length} post${posts.length === 1 ? "" : "s"}.`,
          "Canny vote counts, comments and categories are not imported.",
        ],
        rows: posts.map(toPostRow),
      };
    }).pipe(
      // The adapter is the bottom of the provider stack and pins its own HTTP
      // transport, the same boundary the Slack and Discord clients use. Tests
      // supply a fake through `makeCannyImportProvider` instead.
      // eslint-disable-next-line effecttsgo/strict-effect-provide -- provider client pins its transport
      Effect.provide(clientLayer)
    );

  return {
    descriptor: cannyDescriptor,
    fetchPosts,
  };
};

/** The adapter the composition root registers; tests build one with a fake client. */
export const cannyImportProvider = makeCannyImportProvider({});

export { makeCannyImportProvider };
