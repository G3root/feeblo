import { parseArgs } from "node:util";

import postgres from "postgres";

const MAX_DIMENSIONS = 2000;

const main = async () => {
  const { values } = parseArgs({
    options: {
      "clear-existing": { type: "boolean", default: false },
      dimensions: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(`Usage:
  node ./migrate/configure-embeddings.js --dimensions 1536
  node ./migrate/configure-embeddings.js --dimensions 768 --clear-existing`);
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new TypeError("DATABASE_URL is required.");
  }
  const dimensions = Number(
    values.dimensions ?? process.env.EMBEDDING_DIMENSIONS ?? 1536
  );
  if (
    !Number.isSafeInteger(dimensions) ||
    dimensions < 1 ||
    dimensions > MAX_DIMENSIONS
  ) {
    throw new TypeError(
      `Embedding dimensions must be an integer between 1 and ${MAX_DIMENSIONS}.`
    );
  }

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    const [{ count }] = await sql<[{ count: number }]>`
      SELECT count(*)::integer AS count
      FROM post
      WHERE embedding IS NOT NULL
        AND vector_dims(embedding) <> ${dimensions}
    `;
    if (count > 0 && !values["clear-existing"]) {
      throw new TypeError(
        `${count} posts have incompatible embeddings. Re-run with --clear-existing.`
      );
    }
    await sql.begin(async (tx) => {
      await tx`DROP INDEX IF EXISTS post_embedding_hnsw_idx`;
      if (values["clear-existing"]) {
        await tx`
          UPDATE post
          SET embedding = NULL, embedding_model = NULL, embedded_at = NULL
          WHERE embedding IS NOT NULL
        `;
      }
      await tx.unsafe(`
        ALTER TABLE post
        ALTER COLUMN embedding
        TYPE vector(${dimensions})
        USING embedding::vector(${dimensions})
      `);
      await tx`
        CREATE INDEX post_embedding_hnsw_idx
        ON post USING hnsw (embedding vector_cosine_ops)
        WHERE embedding IS NOT NULL
      `;
    });
    console.log(`Post embeddings configured for ${dimensions} dimensions.`);
  } finally {
    await sql.end();
  }
};

main().catch((error) => {
  console.error("Failed to configure post embeddings:", error);
  process.exitCode = 1;
});
