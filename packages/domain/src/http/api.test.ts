import { describe, expect, it } from "@effect/vitest";
import * as OpenApi from "effect/http-api/OpenApi";

import { WidgetApi } from "../widget/api-contract";
import { Api } from "./api";

/**
 * The dashboard's document describes the dashboard.
 *
 * The widget is the opposite contract from the dashboard — cross-origin,
 * unauthenticated, its own `/api/widget/v1` prefix — so it composes its own
 * route (`../widget/router.ts`) instead of being flattened into `Api` with
 * `.addHttpApi(WidgetApi)`. Before the split, one `HttpApiBuilder.layer` served
 * both contracts and `/docs/openapi.json` documented an API no dashboard client
 * calls.
 *
 * The document is derived from the `HttpApi` instances, so it is where the
 * split is observable: the dashboard's paths and groups, and the widget's, are
 * disjoint. A future `.addHttpApi(WidgetApi)` on `Api` fails both halves.
 */

const dashboardPaths = Object.keys(OpenApi.fromApi(Api).paths);
const widgetPaths = Object.keys(OpenApi.fromApi(WidgetApi).paths);

describe("dashboard Api", () => {
  it("does not declare the widget's group", () => {
    expect(Object.keys(Api.groups)).not.toContain("WidgetApiGroup");
  });

  it("publishes no widget endpoint", () => {
    expect(
      dashboardPaths.filter((path) => path.startsWith("/api/widget/"))
    ).toEqual([]);
  });

  it("still declares its own groups", () => {
    // Guard against a split that removes the widget by emptying the dashboard:
    // the widget's four paths are gone, the dashboard's own are not.
    expect(Object.keys(Api.groups).length).toBeGreaterThan(0);
    expect(dashboardPaths.length).toBeGreaterThan(0);
  });
});

describe("WidgetApi", () => {
  it("declares its own group and no other", () => {
    expect(Object.keys(WidgetApi.groups)).toEqual(["WidgetApiGroup"]);
  });

  it("keeps the published widget paths under its own version prefix", () => {
    // The widget's HTTP shape is a contract with the embedded iframe bundle
    // (`packages/feedback-widget/src/lib/requests.ts` builds these URLs), so
    // the move to its own route must not rename, regroup, or re-prefix them.
    expect(widgetPaths.sort()).toEqual([
      "/api/widget/v1/boards",
      "/api/widget/v1/feedback",
      "/api/widget/v1/suggestions",
      "/api/widget/v1/updates",
    ]);
  });
});
