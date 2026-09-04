import { hasWindow } from "@feeblo/utils/runtime-kind";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Client-side singleton to ensure the same instance is used across the app
let clientQueryClient: QueryClient | null = null;

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Collections without an explicit `staleTime` (most of them) would
        // otherwise refetch on every mount and window focus, fanning out
        // into an RPC storm across the ~11 preloaded collections. A minute
        // of freshness, no focus refetch, and a single retry keeps
        // navigation cheap; collections with fresher needs set their own
        // `staleTime`/`refetchInterval` per query.
        staleTime: 60_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}

export function getContext() {
  // Server: always create a new QueryClient per request to avoid data leaks
  if (!hasWindow()) {
    return {
      queryClient: makeQueryClient(),
    };
  }

  // Client: use singleton to preserve cache across navigations
  if (!clientQueryClient) {
    clientQueryClient = makeQueryClient();
  }
  return {
    queryClient: clientQueryClient,
  };
}

export function Provider({
  children,
  queryClient,
}: {
  children: React.ReactNode;
  queryClient: QueryClient;
}) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
