// biome-ignore-all lint/suspicious/noConsole: CLI script requires console output
import { Effect } from "effect";
import { Database } from "./src";
import { nukeDatabase } from "./src/nuke";

const nuke = Effect.gen(function* () {
  console.log("Nuking database...\n");
  yield* nukeDatabase();
  console.log("Database reset complete.");
});

Effect.runPromise(nuke.pipe(Effect.provide(Database.Database.Client))).catch(
  (error) => {
    console.error("Database nuke failed:", error);
    process.exit(1);
  }
);
