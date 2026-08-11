import * as http from "node:http";
import { afterEach } from "@effect/vitest";
import * as Effect from "effect/Effect";

/** Ephemeral loopback servers created by tests; closed after every test. */
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve()))
      )
  );
});

/**
 * Starts an ephemeral loopback HTTP server for a test receiver and returns its
 * `/hook` URL. The server is registered for automatic teardown after the test.
 */
export const startTestServer = (handler: http.RequestListener) =>
  Effect.tryPromise(
    () =>
      new Promise<URL>((resolve, reject) => {
        const server = http.createServer(handler);
        servers.push(server);
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          if (address === null || typeof address === "string") {
            reject(new TypeError("Expected TCP test server"));
            return;
          }
          resolve(new URL(`http://127.0.0.1:${address.port}/hook`));
        });
      })
  );
