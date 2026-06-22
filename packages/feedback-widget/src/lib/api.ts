import { query, type RoutePreloadFuncArgs } from "@solidjs/router";

export interface WidgetBoard {
  createdAt: string;
  id: string;
  name: string;
  organizationId: string;
  slug: string;
  updatedAt: string;
}

function getApiBaseUrl(): string {
  //@ts-expect-error
  return window.global.__ENV.API_URL as string;
}

export function getOrganizationId(): string {
  //@ts-expect-error
  return window.global.__ENV.organizationId as string;
}

export const fetchBoards = query(async (): Promise<WidgetBoard[]> => {
  const organizationId = getOrganizationId();
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/api/widget/v1/boards?organizationId=${encodeURIComponent(organizationId)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch boards: ${res.status}`);
  }
  return res.json();
}, "boards");

export function preloadBoards(_args: RoutePreloadFuncArgs) {
  return fetchBoards();
}
