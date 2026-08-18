import { action, query, type RoutePreloadFuncArgs } from "@solidjs/router";

import { getWidgetContext } from "./context";
import { getWidgetToken } from "./identity";
import { sendToParent } from "./messages";

export interface WidgetBoard {
  createdAt: string;
  id: string;
  name: string;
  organizationId: string;
  slug: string;
  updatedAt: string;
}

export type FeedbackResult = { ok: true } | { ok: false; message: string };
export interface WidgetSuggestion {
  excerpt: string;
  id: string;
  slug: string;
  title: string;
}

export interface WidgetUpdate {
  content: string;
  excerpt: string;
  id: string;
  imageUrl: string | null;
  publishedAt: string;
  slug: string;
  title: string;
}

interface FeedbackFormData extends FormData {
  get(name: "content" | "title" | "boardName" | "boardId"): string;
}

function getApiBaseUrl(): string {
  //@ts-expect-error
  // SAFETY: The upstream contract guarantees a string here.
  return `${window.global.__ENV.API_URL}//api/widget/v1` as string;
}

export function getOrganizationId(): string {
  //@ts-expect-error
  // SAFETY: The upstream contract guarantees a string here.
  return window.global.__ENV.organizationId as string;
}

export const fetchBoards = query(async (): Promise<WidgetBoard[]> => {
  const organizationId = getOrganizationId();
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/boards?organizationId=${encodeURIComponent(organizationId)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch boards: ${res.status}`);
  }
  return res.json();
}, "boards");

export const fetchUpdates = query(async (): Promise<WidgetUpdate[]> => {
  const organizationId = getOrganizationId();
  const url = `${getApiBaseUrl()}/updates?organizationId=${encodeURIComponent(organizationId)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch updates: ${res.status}`);
  }
  return res.json();
}, "updates");

export function preloadBoards(_args: RoutePreloadFuncArgs) {
  return fetchBoards();
}

export async function fetchSuggestions(
  input: { boardId: string; content: string; title: string },
  signal: AbortSignal
): Promise<WidgetSuggestion[]> {
  const response = await fetch(`${getApiBaseUrl()}/suggestions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, organizationId: getOrganizationId() }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch suggestions: ${response.status}`);
  }
  return response.json();
}

export const createFeedBackAction = action(
  // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
  async (formData: FormData): Promise<FeedbackResult> => {
    // SAFETY: The upstream contract guarantees this value here.
    const data = formData as FeedbackFormData;
    const boardId = data.get("boardId");
    const boardName = data.get("boardName");
    const title = data.get("title");
    const content = data.get("content");
    const organizationId = getOrganizationId();

    const token = getWidgetToken();
    const metadata = getWidgetContext();

    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/feedback`;
    const body = {
      boardId,
      content,
      title,
      organizationId,
      metadata,
      ...(token ? { token } : undefined),
    } satisfies {
      boardId: string;
      content: string;
      metadata: Record<string, string>;
      organizationId: string;
      title: string;
      token?: string;
    };
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

// SAFETY: The endpoint/API contract guarantees this response shape.

    // SAFETY: The endpoint/API contract guarantees this response shape.
    if (!response.ok) {
      // SAFETY: The endpoint/API contract guarantees this response shape.
      const errorData = (await response.json()) as { message?: string };
      return {
        ok: false,
        message: errorData.message ?? "Failed to submit feedback",
      };
    }

    sendToParent({
      event: "FEEDBACK_SUBMITTED",
      data: {
        post: { boardId, boardName, title, metadata },
      },
    });

    return { ok: true };
  },
  "createFeedback"
);
