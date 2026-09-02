/* eslint-disable anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unsafe-dictionary-type -- CLI boundary validation for DB rows */
import { parseArgs } from "node:util";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { isObject } from "@feeblo/utils/runtime-kind";
import postgres from "postgres";

const DEFAULT_DIMENSIONS = 1536;
const MAX_VECTOR_DIMENSIONS = 2000;

interface SqlClient {
  readonly close: () => Promise<void>;
  readonly execute: (statement: string) => Promise<readonly unknown[]>;
}

const makeClient = (databaseUrl: string): SqlClient => {
  if (databaseUrl.startsWith("pglite:")) {
    const client = new PGlite(databaseUrl.slice("pglite:".length), {
      extensions: { vector },
    });
    return {
      close: () => client.close(),
      execute: async (statement) => {
        const result = await client.query(statement);
        return result.rows;
      },
    };
  }

  const client = postgres(databaseUrl, { max: 1 });
  return {
    close: () => client.end(),
    execute: async (statement) => await client.unsafe(statement),
  };
};

const parseDimensions = (value: string | undefined): number => {
  const raw = (value ?? String(DEFAULT_DIMENSIONS)).trim();
  if (!/^\d+$/.test(raw)) {
    throw new TypeError(
      `Embedding dimensions must be an integer between 1 and ${MAX_VECTOR_DIMENSIONS}.`
    );
  }
  const dimensions = Number(raw);
  if (
    !Number.isSafeInteger(dimensions) ||
    dimensions < 1 ||
    dimensions > MAX_VECTOR_DIMENSIONS
  ) {
    throw new TypeError(
      `Embedding dimensions must be an integer between 1 and ${MAX_VECTOR_DIMENSIONS}.`
    );
  }
  return dimensions;
};

const readCount = (rows: readonly unknown[]): number => {
  const row = rows[0];
  if (!(isObject(row) && "count" in row)) {
    throw new TypeError("Database returned an invalid count.");
  }
  // SAFETY: isObject + "count" in row establishes row is a record with a count property
  const rawCount = (row as Record<string, unknown>).count;
  if (typeof rawCount !== "string" && typeof rawCount !== "number") {
    throw new TypeError("Database returned an invalid count.");
  }
  const trimmed = typeof rawCount === "string" ? rawCount.trim() : rawCount;
  if (typeof trimmed === "string" && !/^\d+$/.test(trimmed)) {
    throw new TypeError("Database returned an invalid count.");
  }
  const count = Number(trimmed);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError("Database returned an invalid count.");
  }
  return count;
};

const main = async (): Promise<void> => {
  const { values } = parseArgs({
    options: {
      "clear-existing": { type: "boolean", default: false },
      dimensions: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`Configure the single embedding vector type for this deployment.

Usage:
  pnpm db:configure-embeddings --dimensions 1536
  pnpm db:configure-embeddings --dimensions 768 --clear-existing

Options:
  --dimensions <number>  Vector dimensions (default: EMBEDDING_DIMENSIONS or 1536)
  --clear-existing       Clear incompatible embeddings before changing dimensions
  -h, --help             Show this help`);
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new TypeError("DATABASE_URL is required.");
  }
  const dimensions = parseDimensions(
    values.dimensions ?? process.env.EMBEDDING_DIMENSIONS
  );
  const client = makeClient(databaseUrl);

  try {
    await client.execute("CREATE EXTENSION IF NOT EXISTS vector");
    const incompatibleRows = await client.execute(`
      SELECT count(*) AS count
      FROM post
      WHERE embedding IS NOT NULL
        AND vector_dims(embedding) <> ${dimensions}
    `);
    const incompatibleCount = readCount(incompatibleRows);
    if (incompatibleCount > 0 && !values["clear-existing"]) {
      throw new TypeError(
        `${incompatibleCount} posts have incompatible embeddings. Re-run with --clear-existing to remove them before changing dimensions.`
      );
    }

    await client.execute("BEGIN");
    try {
      await client.execute("DROP INDEX IF EXISTS post_embedding_hnsw_idx");
      if (values["clear-existing"]) {
        await client.execute(`
          UPDATE post
          SET embedding = NULL,
              embedding_model = NULL,
              embedded_at = NULL
          WHERE embedding IS NOT NULL
        `);
      }
      await client.execute(`
        ALTER TABLE post
        ALTER COLUMN embedding
        TYPE vector(${dimensions})
        USING embedding::vector(${dimensions})
      `);
      await client.execute(`
        CREATE INDEX post_embedding_hnsw_idx
        ON post
        USING hnsw (embedding vector_cosine_ops)
        WHERE embedding IS NOT NULL
      `);
      await client.execute("COMMIT");
    } catch (error) {
      await client.execute("ROLLBACK");
      throw error;
    }

    console.log(
      `Post embeddings configured for ${dimensions} dimensions.${values["clear-existing"] ? " Existing embeddings were cleared." : ""}`
    );
  } finally {
    await client.close();
  }
};

main().catch((error) => {
  console.error("Failed to configure post embeddings:", error);
  process.exitCode = 1;
});
