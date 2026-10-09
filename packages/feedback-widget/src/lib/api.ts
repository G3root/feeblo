import { action, query, type RoutePreloadFuncArgs } from "@solidjs/router";

import { requestBoards, requestUpdates, submitFeedback } from "./requests";

export type {
  FeedbackResult,
  WidgetBoard,
  WidgetSuggestion,
  WidgetUpdate,
} from "./requests";
export { fetchSuggestions, getOrganizationId } from "./requests";

/**
 * The router-facing half of the widget's HTTP boundary.
 *
 * The request/decode work lives in `requests.ts`, free of the Solid router so
 * it can be tested without one; this module only teaches Solid's cache and
 * submission primitives about those functions.
 */

export const fetchBoards = query(requestBoards, "boards");

export const fetchUpdates = query(requestUpdates, "updates");

export function preloadBoards(_args: RoutePreloadFuncArgs) {
  return fetchBoards();
}

export function preloadUpdates(_args: RoutePreloadFuncArgs) {
  return fetchUpdates();
}

export const createFeedBackAction = action(submitFeedback, "createFeedback");
