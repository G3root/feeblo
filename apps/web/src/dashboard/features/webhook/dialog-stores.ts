import { createModalStoreContext } from "@feeblo/web-shared/xstate";

import type { Endpoint } from "./atoms";

export const [WebhookCreateDialogProvider, useWebhookCreateDialogContext] =
  createModalStoreContext<Record<string, never>>({
    name: "WebhookCreateDialogContext",
    hookName: "useWebhookCreateDialogContext",
    providerName: "WebhookCreateDialogProvider",
  });

export const [WebhookEditSheetProvider, useWebhookEditSheetContext] =
  createModalStoreContext<{ endpoint: Endpoint }>({
    name: "WebhookEditSheetContext",
    hookName: "useWebhookEditSheetContext",
    providerName: "WebhookEditSheetProvider",
  });
