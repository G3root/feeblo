import { makeImportProviderRegistryLayer } from "../provider";
import { cannyImportProvider } from "./canny";
import { noltImportProvider } from "./nolt";
import { productboardImportProvider } from "./productboard";

/**
 * The import sources this deployment offers, in the order the dashboard
 * renders their cards. A provider is one line here plus its adapter: the RPC,
 * the credential form, the planner and the worker are shared.
 */
const importProviderAdapters = [
  cannyImportProvider,
  noltImportProvider,
  productboardImportProvider,
] as const;

/** The registry every data-transfer service and handler layer depends on. */
export const ImportProviderRegistryLive = makeImportProviderRegistryLayer(
  importProviderAdapters
);
