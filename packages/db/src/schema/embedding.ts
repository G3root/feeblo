import { customType } from "drizzle-orm/pg-core";
import * as Schema from "effect/Schema";

const VectorValues = Schema.Array(Schema.Finite);

/**
 * The embedding width the workspace shares across every embedded row.
 *
 * One constant rather than one per table: an embedding service is configured
 * per deployment (`EMBEDDING_DIMENSIONS`), and two tables reading two defaults
 * would produce vectors that cannot be compared against each other or against
 * the model the deployment actually uses.
 */
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

/**
 * A pgvector column.
 *
 * The driver hands a vector over as its text form, so the column decodes and
 * re-encodes it on the way in and out. Every caller uses the same decoder —
 * a per-table copy is how two columns end up with two tolerances for the same
 * value.
 */
export const embeddingVector = (dimensions: number) =>
  customType<{
    data: number[];
    driverData: string;
  }>({
    dataType: () => `vector(${dimensions})`,
    fromDriver: (value) =>
      Array.from(
        // Drizzle's customType callbacks are synchronous by API contract, so
        // this decode cannot be composed through Effect; a malformed stored
        // vector throwing here surfaces as a query failure.
        // eslint-disable-next-line effecttsgo/schema-sync -- Drizzle customType is sync
        Schema.decodeUnknownSync(VectorValues)(JSON.parse(value))
      ),
    toDriver: (value) =>
      // eslint-disable-next-line effecttsgo/schema-sync -- Drizzle customType is sync
      JSON.stringify(Schema.decodeSync(VectorValues)(value)),
  });
