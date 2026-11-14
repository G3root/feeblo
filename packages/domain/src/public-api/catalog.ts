import { isString } from "@feeblo/utils/runtime-kind";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { PublicApiOperations } from "./operations";

/**
 * The agent-facing catalog of the Public API's operations, and the search over
 * it that code mode's `search` tool answers from.
 *
 * Code mode exists because one MCP tool per operation is a large prompt: a
 * client that lists forty tools asks its model to read forty schemas before it
 * can do anything, and a model that then chains three calls pays for three
 * round trips. The catalog is the other half of that trade: `search` returns
 * the few tools a task needs, with the TypeScript signature each one has inside
 * `execute`, and the model writes one program that calls them.
 *
 * Everything here is derived from the registry ADR 0007 made the unit, so the
 * signature a model reads is printed from the same schema the operation
 * validates with, and a new operation appears in `search` with no edit here.
 */

/**
 * The JSON Schema keywords this module reads.
 *
 * A schema, so a node is decoded at the boundary rather than read through an
 * index signature: the keywords below are the whole vocabulary a signature
 * needs, and every other key a real document carries (`description`,
 * `additionalProperties`, …) is ignored by the decode.
 */
const JsonSchemaNode = Schema.Struct({
  $ref: Schema.optional(Schema.String),
  anyOf: Schema.optional(Schema.Array(Schema.Json)),
  oneOf: Schema.optional(Schema.Array(Schema.Json)),
  allOf: Schema.optional(Schema.Array(Schema.Json)),
  enum: Schema.optional(Schema.Array(Schema.Json)),
  const: Schema.optional(Schema.Json),
  type: Schema.optional(
    Schema.Union([Schema.String, Schema.Array(Schema.String)])
  ),
  properties: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
  required: Schema.optional(Schema.Array(Schema.String)),
  items: Schema.optional(Schema.Json),
});

type JsonSchemaNode = typeof JsonSchemaNode.Type;

/** The named definitions a document's `$ref`s point into. */
type Definitions = Readonly<Record<string, JsonSchemaNode>>;

const decodeNode = Schema.decodeUnknownOption(JsonSchemaNode);

const decodeDefinitions = Schema.decodeUnknownSync(
  Schema.Record(Schema.String, JsonSchemaNode)
);

const definitionRef = /^#\/(?:\$defs|definitions)\/(?<name>.+)$/u;

/** A property name, quoted only when it is not an identifier. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

const printKey = (name: string): string =>
  IDENTIFIER.test(name) ? name : JSON.stringify(name);

const printLiteral = (value: Schema.Json): string =>
  JSON.stringify(value) ?? "undefined";

/** How deep a signature may nest before it degrades to `unknown`. */
const MAX_DEPTH = 24;

/**
 * A JSON Schema value decoded into the node this module reads.
 *
 * `Schema.Json` values arrive from union members, object properties, and array
 * items; every one of them is decoded here rather than read through a cast, so
 * a scalar in a position where a node belongs degrades to `unknown` instead of
 * throwing on a missing field.
 */
const printValue = (
  value: Schema.Json,
  definitions: Definitions,
  depth: number
): string => {
  const decoded = decodeNode(value);
  return Option.isNone(decoded)
    ? "unknown"
    : printNode(decoded.value, definitions, depth);
};

/**
 * A TypeScript spelling of one JSON Schema node.
 *
 * The output is for a model to read, not for a compiler: it is deliberately
 * small (no `readonly`, no generics beyond `Array`) and it degrades to
 * `unknown` rather than recursing forever, because a signature that a model
 * cannot finish reading is worse than one that is imprecise in a corner.
 */
const printNode = (
  node: JsonSchemaNode,
  definitions: Definitions,
  depth: number
): string => {
  if (depth > MAX_DEPTH) return "unknown";

  const ref = node.$ref;
  if (ref !== undefined) {
    const name = definitionRef.exec(ref)?.groups?.name;
    const definition = name === undefined ? undefined : definitions[name];
    return definition === undefined
      ? "unknown"
      : printNode(definition, definitions, depth + 1);
  }

  const union = node.anyOf ?? node.oneOf;
  if (union !== undefined) {
    return [
      ...new Set(
        union.map((member) => printValue(member, definitions, depth + 1))
      ),
    ].join(" | ");
  }

  const intersection = node.allOf;
  if (intersection !== undefined) {
    return [
      ...new Set(
        intersection.map((member) => printValue(member, definitions, depth + 1))
      ),
    ].join(" & ");
  }

  if (node.enum !== undefined) {
    return node.enum.map((member) => printLiteral(member)).join(" | ");
  }

  if (node.const !== undefined) return printLiteral(node.const);

  const declared = node.type;
  const types =
    declared === undefined ? [] : isString(declared) ? [declared] : declared;

  if (types.length > 0) {
    return [
      ...new Set(
        types.map((type) => printType(type, node, definitions, depth))
      ),
    ].join(" | ");
  }

  if (node.properties !== undefined) {
    return printObject(node, definitions, depth);
  }
  if (node.items !== undefined) {
    return `Array<${printValue(node.items, definitions, depth + 1)}>`;
  }
  return "unknown";
};

const printType = (
  type: string,
  node: JsonSchemaNode,
  definitions: Definitions,
  depth: number
): string => {
  switch (type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array":
      return node.items === undefined
        ? "Array<unknown>"
        : `Array<${printValue(node.items, definitions, depth + 1)}>`;
    case "object":
      return printObject(node, definitions, depth);
    default:
      return "unknown";
  }
};

const printObject = (
  node: JsonSchemaNode,
  definitions: Definitions,
  depth: number
): string => {
  const properties = node.properties ?? {};
  const required = new Set(node.required ?? []);

  const fields = Object.entries(properties).map(
    ([name, value]) =>
      `${printKey(name)}${required.has(name) ? "" : "?"}: ${printValue(
        value,
        definitions,
        depth + 1
      )}`
  );

  // `additionalProperties` is deliberately not printed. The Public API's
  // schemas accept an open object, so every struct would grow a
  // `[key: string]: unknown` line; a signature is a hint for a model, and the
  // hint that matters is which fields the operation reads, not that passing an
  // extra one is tolerated.
  return fields.length === 0
    ? "Record<string, unknown>"
    : `{ ${fields.join("; ")} }`;
};

const printSchema = (schema: Schema.Top): string => {
  const document = Schema.toJsonSchemaDocument(schema);
  const root = decodeNode(document.schema);
  return Option.isNone(root)
    ? "unknown"
    : printNode(root.value, decodeDefinitions(document.definitions), 0);
};

/** One operation, as `search` describes it and `execute` can call it. */
export interface CatalogEntry {
  /** The operation's published name, which is the tool name inside `execute`. */
  readonly name: string;
  readonly description: string;
  /** `(input: { ... }) => Promise<...>`, the shape `tools.<name>` has. */
  readonly signature: string;
  /** The scope the key must hold; a call without it fails as a thrown error. */
  readonly scope: string;
  readonly readOnly: boolean;
  readonly destructive: boolean;
}

export interface OperationCatalog {
  readonly entries: readonly CatalogEntry[];
}

/**
 * Builds the catalog from the registry.
 *
 * Called once when the code-mode route's layers are built rather than at module
 * load: a deployment that never mounts the route should not pay for forty
 * schema-to-JSON conversions, and the HTTP route imports the same registry.
 */
export const makeOperationCatalog = (): OperationCatalog => ({
  entries: PublicApiOperations.map((operation) => ({
    description: operation.description,
    destructive: operation.annotations.destructive,
    name: operation.name,
    readOnly: operation.annotations.readOnly,
    scope: operation.scope,
    signature: `(input: ${printSchema(operation.input)}) => Promise<${printSchema(operation.output)}>`,
  })),
});

/** A word a model searched for, lowercased and split on every non-word run. */
const words = (text: string): readonly string[] =>
  text
    .replaceAll(/(?<lower>[a-z])(?<upper>[A-Z])/gu, "$<lower> $<upper>")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((word) => word.length > 0);

export interface CatalogSearchOptions {
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

export interface CatalogMatch extends CatalogEntry {
  /** A deterministic relevance hint; higher sorts first. */
  readonly score: number;
}

export interface CatalogSearchResult {
  readonly matches: readonly CatalogMatch[];
  /** How many entries matched before the page was cut. */
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}

export const DEFAULT_SEARCH_LIMIT = 5;

export const MAX_SEARCH_LIMIT = 20;

/** Every entry's searchable text, lowercased once per query. */
const scoreEntry = (
  entry: CatalogEntry,
  normalizedQuery: string,
  tokens: readonly string[]
): number => {
  const name = entry.name.toLowerCase();
  const searchable = `${entry.description} ${entry.signature}`.toLowerCase();

  let score = 0;
  if (name === normalizedQuery) score += 100;
  else if (name.includes(normalizedQuery)) score += 40;

  let matched = 0;
  for (const token of tokens) {
    if (name.includes(token)) score += 10;
    if (searchable.includes(token)) score += 2;
    if (name.includes(token) || searchable.includes(token)) matched += 1;
  }

  // A query whose every word is somewhere in the entry is a better match than
  // one long token that happens to appear in a description.
  return matched === tokens.length && tokens.length > 0 ? score + 5 : score;
};

/**
 * Ranks the catalog for a query and returns one page.
 *
 * Ranks, rather than embeds: the catalog is tens of entries, its vocabulary is
 * the operations' own names, and a deterministic score makes a model's
 * behaviour reproducible across runs. An entry only matches when at least one
 * query word appears in it, so an unrelated query answers with an empty page
 * instead of five arbitrary tools.
 */
export const searchCatalog = (
  catalog: OperationCatalog,
  query: string,
  options: CatalogSearchOptions = {}
): CatalogSearchResult => {
  const limit = Math.min(
    MAX_SEARCH_LIMIT,
    Math.max(1, Math.trunc(options.limit ?? DEFAULT_SEARCH_LIMIT))
  );
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const normalizedQuery = query.trim().toLowerCase();
  const tokens = [...new Set(words(query))];

  const matches = catalog.entries
    .map((entry) => ({
      ...entry,
      score: scoreEntry(entry, normalizedQuery, tokens),
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.name.localeCompare(right.name)
    );

  return {
    limit,
    matches: matches.slice(offset, offset + limit),
    offset,
    total: matches.length,
  };
};
