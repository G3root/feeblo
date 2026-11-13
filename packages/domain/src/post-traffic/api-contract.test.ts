import { describe, expect, it } from "@effect/vitest";
import * as OpenApi from "effect/http-api/OpenApi";

import { PostTrafficApi } from "./api-contract";

describe("PostTrafficApi", () => {
  it("publishes the ingest at the path the board relay calls", () => {
    const document = OpenApi.fromApi(PostTrafficApi);

    expect(Object.keys(document.paths)).toEqual(["/api/traffic/v1/views"]);
  });
});
