/**
 * Moved to `apps/web/src/lib/atom-rpc.ts`: the portal reads through the same
 * client now, and a `src/portal` module importing `~/lib/atom-rpc` would read
 * as a dependency on the dashboard.
 */
export * from "@/lib/atom-rpc";
