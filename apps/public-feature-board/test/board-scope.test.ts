import { DbClient } from "@tanstack/react-db";
import { describe, expect, it } from "vitest";

import {
  BOARD_SCOPE_DEPENDENCY,
  createBoardScope,
  isBoardPreloadDegraded,
  markBoardPreloadDegraded,
  setBoardOrganizationId,
} from "../src/lib/board-scope";

/** A real client carrying the scope, the way a board document builds one. */
function clientWith(scope: ReturnType<typeof createBoardScope>): DbClient {
  return new DbClient({ [BOARD_SCOPE_DEPENDENCY]: scope });
}

describe("createBoardScope", () => {
  it("resolves the viewed post slug from the current pathname", () => {
    let pathname = "/p/hello-world";
    const scope = createBoardScope({ pathname: () => pathname });

    expect(scope.getPostSlug()).toBe("hello-world");

    pathname = "/roadmap";
    expect(scope.getPostSlug()).toBeUndefined();
  });

  it("resolves the changelog slug behind the internal /s prefix", () => {
    const scope = createBoardScope({
      pathname: () => "/s/changelog/launch-notes",
    });

    expect(scope.getChangelogSlug()).toBe("launch-notes");
  });

  it("resolves slugs lazily, so a browser client stays correct across navigations", () => {
    let pathname = "/p/first";
    const scope = createBoardScope({ pathname: () => pathname });

    expect(scope.getPostSlug()).toBe("first");

    pathname = "/p/second";
    expect(scope.getPostSlug()).toBe("second");
  });
});

describe("setBoardOrganizationId", () => {
  it("publishes the resolved site's organization onto the client's scope", () => {
    const scope = createBoardScope({ pathname: () => "/" });

    setBoardOrganizationId(clientWith(scope), "org_123");

    expect(scope.getOrganizationId()).toBe("org_123");
  });

  it("keeps organizations isolated per scope", () => {
    const first = createBoardScope({ pathname: () => "/" });
    const second = createBoardScope({ pathname: () => "/" });

    setBoardOrganizationId(clientWith(first), "org_a");
    setBoardOrganizationId(clientWith(second), "org_b");

    expect(first.getOrganizationId()).toBe("org_a");
    expect(second.getOrganizationId()).toBe("org_b");
  });
});

describe("preload degradation", () => {
  it("records it per request scope, not globally", () => {
    const degradedScope = createBoardScope({ pathname: () => "/" });
    const healthyScope = createBoardScope({ pathname: () => "/" });

    expect(isBoardPreloadDegraded(clientWith(healthyScope))).toBe(false);

    markBoardPreloadDegraded(clientWith(degradedScope));

    expect(isBoardPreloadDegraded(clientWith(degradedScope))).toBe(true);
    expect(isBoardPreloadDegraded(clientWith(healthyScope))).toBe(false);
  });
});
