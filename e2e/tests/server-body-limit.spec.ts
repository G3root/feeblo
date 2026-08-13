import { request as httpRequest } from "node:http";
import { expect, test } from "@playwright/test";

const apiURL = process.env.E2E_API_URL ?? "http://localhost:3100";

test("rejects an oversized chunked Better Auth request", async () => {
  const status = await new Promise<number>((resolve, reject) => {
    const target = new URL("/api/auth/sign-in/jwt-auto-login", apiURL);
    const request = httpRequest(
      target,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "transfer-encoding": "chunked",
        },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode ?? 0));
      }
    );
    request.on("error", reject);
    request.write("x".repeat(600_000));
    request.end("x".repeat(600_000));
  });

  expect(status).toBe(413);
});
