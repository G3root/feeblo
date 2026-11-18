import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { ParsedBoardPostRow } from "../csv";
import {
  type DataImportProviderError,
  DataImportProviderCredentialError,
  DataImportProviderEmptyError,
  DataImportProviderResponseError,
  DataImportRowLimitError,
} from "../errors";
import { DATA_IMPORT_MAX_ROWS } from "../limits";
import type { ImportProviderAdapter, ProviderImportResult } from "../provider";
import type { TDataImportProviderDescriptor } from "../provider-schema";
import { executeProviderRequest, PROVIDER_LABELS } from "./http";

const PRODUCTBOARD_PROVIDER_ID = "productboard" as const;

const PRODUCTBOARD_ORIGIN = "https://api.productboard.com";

const productboardDescriptor: TDataImportProviderDescriptor = {
  carries: ["Features as posts", "Components as boards", "Statuses"],
  credentialFields: [
    {
      description:
        "Productboard workspace settings → Public API → create a token. It is read once and never stored.",
      key: "apiKey",
      label: "Productboard API token",
      placeholder: "Paste your Productboard API token",
      secret: true,
    },
  ],
  helpText:
    "Create a public API token in Productboard under Workspace settings → Public API.",
  helpUrl: "https://app.productboard.com/settings/public-api",
  id: PRODUCTBOARD_PROVIDER_ID,
  name: PROVIDER_LABELS.productboard,
  omissions: [
    "Vote counts, comments and owners are not imported.",
    "Archived features are skipped.",
  ],
  tagline: "Import Productboard features, with their components and statuses.",
};

const ProductboardEntity = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  fields: Schema.optionalKey(
    Schema.Struct({
      archived: Schema.optionalKey(Schema.Boolean),
      description: Schema.optionalKey(Schema.NullOr(Schema.String)),
      name: Schema.optionalKey(Schema.NullOr(Schema.String)),
      status: Schema.optionalKey(
        Schema.NullOr(
          Schema.Struct({ name: Schema.optionalKey(Schema.String) })
        )
      ),
    })
  ),
  relationships: Schema.optionalKey(
    Schema.Struct({
      data: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            target: Schema.optionalKey(
              Schema.Struct({ id: Schema.optionalKey(Schema.String) })
            ),
            type: Schema.optionalKey(Schema.String),
          })
        )
      ),
    })
  ),
  createdAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

type ProductboardEntity = Schema.Schema.Type<typeof ProductboardEntity>;

const ProductboardPage = Schema.Struct({
  data: Schema.Array(ProductboardEntity),
  links: Schema.optionalKey(
    Schema.Struct({ next: Schema.optionalKey(Schema.String) })
  ),
});

/** Productboard descriptions are HTML; a post's body is plain text. */
export const htmlToText = (html: string): string =>
  html
    .replaceAll(/<\s*br\s*\/?>/giu, "\n")
    .replaceAll(/<\s*li[^>]*>/giu, "\n- ")
    .replaceAll(/<\/\s*(?:p|div|h[1-6]|li|ul|ol|blockquote)\s*>/giu, "\n")
    .replaceAll(/<[^>]+>/gu, "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll(/[ \t]+\n/gu, "\n")
    .replaceAll(/\n{3,}/gu, "\n\n")
    .trim();

type EntityKind = "component" | "feature" | "product";

type CollectedEntity = {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly description: string;
  readonly status: string;
  readonly archived: boolean;
  readonly parentId: string | null;
  readonly createdAt: string;
};

const toCollectedEntity = (
  entity: ProductboardEntity
): CollectedEntity | null => {
  const id = entity.id.trim();

  if (id.length === 0) {
    return null;
  }

  const parent = entity.relationships?.data?.find(
    (relationship) => relationship.type === "parent"
  );

  const description = entity.fields?.description;

  return {
    archived: entity.fields?.archived === true,
    createdAt: entity.createdAt ?? "",
    description:
      description === null || description === undefined
        ? ""
        : htmlToText(description),
    id,
    kind: entity.type.toLowerCase(),
    name: (entity.fields?.name ?? "").trim(),
    parentId: parent?.target?.id ?? null,
    status: entity.fields?.status?.name?.trim() ?? "",
  };
};

const isFeature = (entity: CollectedEntity): boolean =>
  entity.kind === "feature" || entity.kind === "subfeature";

/**
 * One page of entities, retried once on a dropped connection.
 *
 * `links.next` is only followed when it stays on the API origin: the token is
 * on every request, so a provider-supplied URL pointing elsewhere would leak
 * it to a host this importer never chose.
 */
const fetchPage = ({
  label,
  token,
  url,
}: {
  readonly label: string;
  readonly token: string;
  readonly url: string;
}): Effect.Effect<
  {
    readonly entities: readonly ProductboardEntity[];
    readonly next: string | null;
  },
  DataImportProviderError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const response = yield* executeProviderRequest({
      label,
      provider: PRODUCTBOARD_PROVIDER_ID,
      request: HttpClientRequest.get(url).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.setHeader("Authorization", `Bearer ${token}`)
      ),
    });

    const body = yield* Schema.decodeUnknownEffect(ProductboardPage)(
      yield* response.json.pipe(
        Effect.mapError(
          (_error) =>
            new DataImportProviderResponseError({
              cause: new Error("Productboard response could not be read."),
              message: `${label} returned a response this importer could not read.`,
              provider: PRODUCTBOARD_PROVIDER_ID,
            })
        )
      )
    ).pipe(
      Effect.mapError(
        (_error) =>
          new DataImportProviderResponseError({
            cause: new Error("Productboard response could not be read."),
            message: `${label} returned a response this importer could not read.`,
            provider: PRODUCTBOARD_PROVIDER_ID,
          })
      )
    );

    const nextRaw = body.links?.next;

    if (nextRaw === undefined) {
      return { entities: body.data, next: null };
    }

    const next = new URL(nextRaw, PRODUCTBOARD_ORIGIN);

    return {
      entities: body.data,
      next: next.origin === PRODUCTBOARD_ORIGIN ? next.toString() : null,
    };
  });

/**
 * Reads every entity of one kind. `type[]` is Productboard's filter; a
 * `feature` and a `subfeature` are both features to this importer, so the
 * caller walks the rest of the graph to name their board.
 */
const listEntities = (
  token: string,
  type: EntityKind
): Effect.Effect<
  readonly CollectedEntity[],
  DataImportProviderError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const collected: CollectedEntity[] = [];

    let url: string | null =
      `${PRODUCTBOARD_ORIGIN}/v2/entities?type[]=${type}`;

    while (url !== null) {
      const page: {
        readonly entities: readonly ProductboardEntity[];
        readonly next: string | null;
      } = yield* fetchPage({
        label: PROVIDER_LABELS.productboard,
        token,
        url,
      });

      for (const entity of page.entities) {
        const collectedEntity = toCollectedEntity(entity);

        if (collectedEntity !== null) {
          collected.push(collectedEntity);
        }
      }

      if (collected.length > DATA_IMPORT_MAX_ROWS) {
        return collected;
      }

      url = page.entities.length > 0 ? page.next : null;
    }

    return collected;
  });

/** The nearest component or product above a feature, walking parents up. */
const boardNameFor = (
  entity: CollectedEntity,
  byId: ReadonlyMap<string, CollectedEntity>
): string => {
  let parentId = entity.parentId;

  for (let depth = 0; parentId !== null && depth < 10; depth += 1) {
    const parent = byId.get(parentId);

    if (parent === undefined) {
      return "";
    }

    if (!isFeature(parent)) {
      return parent.name;
    }

    parentId = parent.parentId;
  }

  return "";
};

const makeProductboardImportProvider = (options: {
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
      const token = input.credentials.apiKey?.trim() ?? "";

      if (token.length === 0) {
        return yield* new DataImportProviderCredentialError({
          message: "Enter a Productboard API token.",
          provider: PRODUCTBOARD_PROVIDER_ID,
        });
      }

      const [features, components, products] = yield* Effect.all(
        [
          listEntities(token, "feature"),
          listEntities(token, "component"),
          listEntities(token, "product"),
        ],
        { concurrency: "unbounded" }
      );

      const byId = new Map<string, CollectedEntity>();

      for (const entity of [...features, ...components, ...products]) {
        byId.set(entity.id, entity);
      }

      const archived = features.filter((feature) => feature.archived).length;

      const active = features.filter(
        (feature) =>
          isFeature(feature) && !feature.archived && feature.name.length > 0
      );

      if (active.length === 0) {
        return yield* new DataImportProviderEmptyError({
          message:
            "Productboard has no features to import. Check that the token can read this workspace's features.",
          provider: PRODUCTBOARD_PROVIDER_ID,
        });
      }

      if (active.length > DATA_IMPORT_MAX_ROWS) {
        return yield* new DataImportRowLimitError({
          maxRows: DATA_IMPORT_MAX_ROWS,
          message: `Productboard returned ${active.length} features. The limit is ${DATA_IMPORT_MAX_ROWS}.`,
        });
      }

      const rows: readonly ParsedBoardPostRow[] = active.map(
        (feature, index): ParsedBoardPostRow => ({
          authorEmail: "",
          authorName: "",
          board: boardNameFor(feature, byId),
          content: feature.description,
          createdAt: feature.createdAt,
          eta: "",
          rowNumber: index + 1,
          status: feature.status,
          tags: [],
          title: feature.name,
          updatedAt: "",
          url: "",
          voteCount: "",
        })
      );

      const notices = [
        `Productboard returned ${rows.length} feature${rows.length === 1 ? "" : "s"}.`,
        "Productboard vote counts and comments are not imported.",
      ];

      if (archived > 0) {
        notices.push(
          `Skipped ${archived} archived feature${archived === 1 ? "" : "s"}.`
        );
      }

      return {
        fingerprint: active
          .map((feature) => feature.id)
          .sort()
          .join("\n"),
        notices,
        rows,
      };
    }).pipe(
      // The adapter is the bottom of the provider stack and pins its own HTTP
      // transport, the same boundary the other provider clients use. Tests
      // supply a fake through `makeProductboardImportProvider` instead.
      // eslint-disable-next-line effecttsgo/strict-effect-provide -- provider client pins its transport
      Effect.provide(clientLayer)
    );

  return {
    descriptor: productboardDescriptor,
    fetchPosts,
  };
};

/** The adapter the composition root registers; tests build one with a fake client. */
export const productboardImportProvider = makeProductboardImportProvider({});

export { makeProductboardImportProvider };
