import type { WidgetModule } from "./config";

/**
 * Surfaces whose first entry in this widget document has been consumed.
 *
 * The row cascade is a first-visit affordance. Route components remount on
 * every tab switch and every back-navigation, and a keyed `Show` remounts its
 * children on revalidation, so without this flag the cascade replays on a
 * frequent action and the list stays empty for up to 480ms while it lands.
 */
const enteredModules = new Set<WidgetModule>();

/** True the first time a surface mounts in this widget document. */
export function consumeSurfaceEntry(module: WidgetModule): boolean {
  if (enteredModules.has(module)) {
    return false;
  }
  enteredModules.add(module);
  return true;
}
