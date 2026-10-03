import { getContext as getWebSharedContext } from "@feeblo/web-shared/integrations/tanstack-query/root-provider";
import type { QueryClient } from "@tanstack/react-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

export { Provider } from "@feeblo/web-shared/integrations/tanstack-query/root-provider";

/**
 * Per-request clients, keyed by the request they belong to.
 *
 * A Worker isolate serves many requests, so a module-level singleton would leak
 * one visitor's cached data into another's. The `Request` object is the
 * request's identity here, and the WeakMap lets it be collected once the
 * response is done.
 */
const requestQueryClients = new WeakMap<Request, QueryClient>();

/**
 * The app's `QueryClient` for the current request or app instance.
 *
 * The shared implementation returns a *fresh* client on every server call
 * ("always create a new QueryClient per request to avoid data leaks"), which is
 * correct about isolation but wrong about identity: the router, the collection
 * `DbClient`, the dashboard boundary, and any `QueryClientProvider` each call
 * it, so a server render would build several clients and hydrate against
 * whichever one it happened to read. Caching per request keeps the isolation
 * guarantee while giving every caller in a request the same instance.
 *
 * `getRequest` is reached only from the `.server()` branch; importing
 * `@tanstack/react-start/server` outside one is rejected by the Start build's
 * `import-protection` plugin.
 */
const resolveQueryClient = createIsomorphicFn()
  .client(() => getWebSharedContext().queryClient)
  .server(() => {
    const request = getRequestOrNull();

    // Outside a request — unit tests, scripts — there is nothing to key the
    // cache by, so every call gets the shared implementation's fresh client.
    if (!request) {
      return getWebSharedContext().queryClient;
    }

    const existing = requestQueryClients.get(request);

    if (existing) {
      return existing;
    }

    const queryClient = getWebSharedContext().queryClient;
    requestQueryClients.set(request, queryClient);

    return queryClient;
  });

/** The current request, or null when this runs outside the server runtime. */
function getRequestOrNull(): Request | null {
  try {
    return getRequest();
  } catch {
    return null;
  }
}

export function getContext() {
  return { queryClient: resolveQueryClient() };
}
