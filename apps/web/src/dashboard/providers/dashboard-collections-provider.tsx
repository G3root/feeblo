import { dashboardCollections } from "../lib/collections";

/**
 * The dashboard's collections for the current scope.
 *
 * `dashboardCollections` is a getter map over the app's `DbClient`: reading a
 * property materializes that collection for the current organization (and post
 * slug) from the same client the router hydrates, and the client memoizes by
 * descriptor id, so repeated reads return the same instance. Components read
 * collections through this hook and route loaders read them through the
 * accessor directly; both cross the same seam.
 */
export function useDashboardCollections() {
  return dashboardCollections;
}
