import { action, query, type RoutePreloadFuncArgs } from "@solidjs/router";
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

interface FeedbackFormData extends FormData {
  get(name: "content" | "title" | "boardName" | "boardId"): string;
}

function getApiBaseUrl(): string {
  //@ts-expect-error
  return `${window.global.__ENV.API_URL}//api/widget/v1` as string;
}

export function getOrganizationId(): string {
  //@ts-expect-error
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

export function preloadBoards(_args: RoutePreloadFuncArgs) {
  return fetchBoards();
}

export const createFeedBackAction = action(
  async (formData: FormData): Promise<FeedbackResult> => {
    const data = formData as FeedbackFormData;
    const boardId = data.get("boardId");
    const boardName = data.get("boardName");
    const title = data.get("title");
    const content = data.get("content");
    const organizationId = getOrganizationId();

    const token = getWidgetToken();

    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/feedback`;
    const body: Record<string, string> = {
      boardId,
      content,
      title,
      organizationId,
    };
    if (token) {
      body.token = token;
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = (await response.json()) as { message?: string };
      return {
        ok: false,
        message: errorData.message ?? "Failed to submit feedback",
      };
    }

    sendToParent({
      event: "FEEDBACK_SUBMITTED",
      data: { post: { boardId, boardName, title } },
    });

    return { ok: true };
  },
  "createFeedback"
);
