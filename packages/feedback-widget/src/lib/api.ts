/* eslint-disable anti-slop/no-unsafe-dictionary-type, anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions -- widget boundary uses plain JS validation (no Effect in this path) */
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

function getWidgetEnv(): Record<string, unknown> | null {
  // SAFETY: window.__ENV is a JSON object injected by the server; validated via string checks below
  const w = window as unknown as { global?: { __ENV?: unknown } };
  const env = w.global?.__ENV;
  if (env === null || typeof env !== "object" || Array.isArray(env))
    return null;
  // SAFETY: checked that env is a non-null non-array object
  return env as Record<string, unknown>;
}

function getRequiredEnvString(key: string): string {
  const env = getWidgetEnv();
  const value = env?.[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`[feeblo-widget] ${key} is not configured`);
  }
  return value.trim();
}

function getApiBaseUrl(): string {
  const apiUrl = getRequiredEnvString("API_URL");
  return `${apiUrl}//api/widget/v1`;
}

export function getOrganizationId(): string {
  return getRequiredEnvString("organizationId");
}

function getRequiredFormString(form: FormData, name: string): string {
  const value = form.get(name);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required field: ${name}`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
// isRecord is a named guard for untrusted JSON boundaries (no Effect dependency here)

export const fetchBoards = query(async (): Promise<WidgetBoard[]> => {
  const organizationId = getOrganizationId();
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/boards?organizationId=${encodeURIComponent(organizationId)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch boards: ${res.status}`);
  }
  const json: unknown = await res.json();
  if (!Array.isArray(json)) throw new Error("Invalid boards response");
  // Validate each board is a record with required string fields at the boundary
  for (const item of json) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.name !== "string"
    ) {
      throw new Error("Invalid board entry");
    }
  }
  return json as WidgetBoard[];
}, "boards");

export const fetchUpdates = query(async (): Promise<WidgetUpdate[]> => {
  const organizationId = getOrganizationId();
  const url = `${getApiBaseUrl()}/updates?organizationId=${encodeURIComponent(organizationId)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch updates: ${res.status}`);
  }
  const json: unknown = await res.json();
  if (!Array.isArray(json)) throw new Error("Invalid updates response");
  for (const item of json) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.title !== "string"
    ) {
      throw new Error("Invalid update entry");
    }
  }
  return json as WidgetUpdate[];
}, "updates");

export function preloadBoards(_args: RoutePreloadFuncArgs) {
  return fetchBoards();
}

export async function fetchSuggestions(
  input: { boardId: string; content: string; title: string },
  signal: AbortSignal
): Promise<WidgetSuggestion[]> {
  if (typeof input.boardId !== "string" || input.boardId.trim().length === 0) {
    throw new Error("boardId is required");
  }
  if (typeof input.title !== "string")
    throw new Error("title must be a string");
  if (typeof input.content !== "string")
    throw new Error("content must be a string");
  const response = await fetch(`${getApiBaseUrl()}/suggestions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, organizationId: getOrganizationId() }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch suggestions: ${response.status}`);
  }
  const json: unknown = await response.json();
  if (!Array.isArray(json)) throw new Error("Invalid suggestions response");
  for (const item of json) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.title !== "string"
    ) {
      throw new Error("Invalid suggestion entry");
    }
  }
  return json as WidgetSuggestion[];
}

export const createFeedBackAction = action(
  async (formData: FormData): Promise<FeedbackResult> => {
    let boardId: string;
    let boardName: string;
    let title: string;
    let content: string;
    try {
      boardId = getRequiredFormString(formData, "boardId");
      boardName = getRequiredFormString(formData, "boardName");
      title = getRequiredFormString(formData, "title");
      content = getRequiredFormString(formData, "content");
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Invalid form data",
      };
    }
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

    if (!response.ok) {
      let message = "Failed to submit feedback";
      try {
        const json: unknown = await response.json();
        if (
          isRecord(json) &&
          typeof json.message === "string" &&
          json.message.trim().length > 0
        ) {
          message = json.message.trim();
        }
      } catch {
        // keep default
      }
      return { ok: false, message };
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
