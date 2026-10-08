import {
  decodeWidgetBoards,
  decodeWidgetBootEnv,
  decodeWidgetError,
  decodeWidgetSuggestions,
  decodeWidgetUpdates,
  type TWidgetBoard,
  type TWidgetBootEnv,
  type TWidgetFeedbackCreateWire,
  type TWidgetSuggestion,
  type TWidgetUpdate,
} from "@feeblo/domain/widget/schema";

import { getWidgetContext } from "./context";
import { getWidgetToken } from "./identity";
import { sendToParent } from "./messages";

/**
 * The widget's HTTP boundary, without the Solid router.
 *
 * The wire shapes and the decoders are the server's own
 * (`@feeblo/domain/widget/schema`), so a rename on either side fails the decode
 * in the iframe where the visitor is instead of silently rendering `undefined`.
 * The functions are plain promises rather than router primitives — `api.ts`
 * wraps them for Solid's cache and submission — which is what makes the seam
 * testable without a router or a DOM.
 */
export type WidgetBoard = TWidgetBoard;
export type WidgetSuggestion = TWidgetSuggestion;
export type WidgetUpdate = TWidgetUpdate;

export type FeedbackResult = { ok: true } | { ok: false; message: string };

interface FeedbackFormData extends FormData {
  get(name: "content" | "title" | "boardName" | "boardId"): string;
}

function getWidgetEnv(): TWidgetBootEnv {
  // The shell assigns `window.global.__ENV` before the bundle runs, so a
  // missing or drifted value is a deployment bug and throws here rather than
  // producing requests to `undefined`.
  return decodeWidgetBootEnv(global?.__ENV);
}

function getApiBaseUrl(): string {
  return `${getWidgetEnv().API_URL}//api/widget/v1`;
}

export function getOrganizationId(): string {
  return getWidgetEnv().organizationId;
}

/** Fetches the organization's public boards and decodes the response. */
export async function requestBoards(): Promise<readonly WidgetBoard[]> {
  const organizationId = getOrganizationId();
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/boards?organizationId=${encodeURIComponent(organizationId)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch boards: ${res.status}`);
  }
  return decodeWidgetBoards(await res.json());
}

/** Fetches the organization's published updates and decodes the response. */
export async function requestUpdates(): Promise<readonly WidgetUpdate[]> {
  const organizationId = getOrganizationId();
  const url = `${getApiBaseUrl()}/updates?organizationId=${encodeURIComponent(organizationId)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch updates: ${res.status}`);
  }
  return decodeWidgetUpdates(await res.json());
}

export async function fetchSuggestions(
  input: { boardId: string; content: string; title: string },
  signal: AbortSignal
): Promise<readonly WidgetSuggestion[]> {
  const response = await fetch(`${getApiBaseUrl()}/suggestions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, organizationId: getOrganizationId() }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch suggestions: ${response.status}`);
  }
  return decodeWidgetSuggestions(await response.json());
}

/**
 * Submits a feedback post.
 *
 * The body is typed with the encoded side of the endpoint's own
 * `WidgetFeedbackCreate` schema, so a field the server no longer accepts is a
 * compile error here; the endpoint remains the runtime validator. The refusal
 * body is decoded through `WidgetError` for the same reason the success bodies
 * are.
 */
export async function submitFeedback(
  formData: FormData
): Promise<FeedbackResult> {
  // SAFETY: the form is built by this widget's own fields, so the four names
  // the narrow view declares are the ones `data.get` receives; the lookup is
  // still null-checked by the schema decode below.
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
  const body: TWidgetFeedbackCreateWire = {
    boardId,
    content,
    title,
    organizationId,
    metadata,
    ...(token ? { token } : undefined),
  };
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = decodeWidgetError(await response.json());
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
}
