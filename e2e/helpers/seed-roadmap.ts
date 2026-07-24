import { type APIRequestContext, expect } from "@playwright/test";

const apiURL = process.env.E2E_API_URL ?? "http://localhost:3100";

export type SeedRoadmapColumn = {
  name: string;
  status: string;
};

/**
 * Creates an extra status roadmap (plus its columns) for a workspace through
 * the test-only `/__e2e/seed-roadmap` endpoint. Column `status` refers to the
 * workspace post status type, e.g. "PLANNED".
 */
export async function seedRoadmap(
  request: APIRequestContext,
  payload: {
    organizationId: string;
    name: string;
    slug: string;
    columns: SeedRoadmapColumn[];
    description?: string;
    visibility?: "public" | "private";
  }
) {
  const response = await request.post(`${apiURL}/__e2e/seed-roadmap`, {
    data: payload,
  });

  expect(response.ok()).toBeTruthy();

  return (await response.json()) as { roadmapId: string };
}

export function organizationIdFromUrl(organizationUrl: string) {
  const organizationId = new URL(organizationUrl).pathname.split("/")[1];

  if (!organizationId) {
    throw new Error(`Missing organization id in url: ${organizationUrl}`);
  }

  return organizationId;
}
