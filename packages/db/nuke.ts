// biome-ignore-all lint/suspicious/noConsole: CLI script requires console output
import { Effect } from "effect";
import { DB } from "./src";
import { nukeDatabase } from "./src/nuke";

const nuke = Effect.gen(function* () {
  console.log("Nuking database...\n");
  yield* nukeDatabase();
  console.log("Database reset complete.");
});

nuke.pipe(Effect.provide(DB.Client), Effect.runPromise).catch((error) => {
  console.error("Database nuke failed:", error);
  process.exit(1);
});
