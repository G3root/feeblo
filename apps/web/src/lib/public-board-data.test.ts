import type { TSite } from "@feeblo/domain/site/schema";
import { describe, expect, it } from "vitest";

import { resolvePageContent } from "./public-board-data";

const date = (iso: string) => new Date(iso);

const site = (overrides: Partial<TSite> = {}): TSite => ({
  id: "site_1",
  name: "Acme Feedback",
  logo: null,
  subdomain: "acme",
  customDomain: null,
  changelogVisibility: "PUBLIC",
  roadmapVisibility: "PUBLIC",
  helpCenterVisibility: "PUBLIC",
  noIndex: false,
  hidePoweredBy: false,
  createdAt: date("2026-01-01T00:00:00.000Z"),
  updatedAt: date("2026-01-01T00:00:00.000Z"),
  organizationId: "org_1",
  ...overrides,
});

const genericPage = {
  kind: "found",
  post: null,
  changelog: null,
  helpArticle: null,
} as const;

describe("resolvePageContent", () => {
  it("rejects the help center index for a workspace that hides it", async () => {
    const hidden = site({ helpCenterVisibility: "HIDDEN" });

    await expect(resolvePageContent("/help", hidden)).resolves.toStrictEqual({
      kind: "not-found",
    });
    await expect(resolvePageContent("/help/", hidden)).resolves.toStrictEqual({
      kind: "not-found",
    });
    await expect(resolvePageContent("/s/help", hidden)).resolves.toStrictEqual({
      kind: "not-found",
    });
  });

  it("keeps the help center index for a public workspace", async () => {
    await expect(resolvePageContent("/help", site())).resolves.toStrictEqual(
      genericPage
    );
    await expect(resolvePageContent("/help/", site())).resolves.toStrictEqual(
      genericPage
    );
  });

  it("rejects a hidden article without reading it", async () => {
    await expect(
      resolvePageContent(
        "/help/articles/setup",
        site({ helpCenterVisibility: "HIDDEN" })
      )
    ).resolves.toStrictEqual({ kind: "not-found" });
  });
});
