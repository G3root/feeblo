/// <reference types="vite/client" />

/**
 * The HTML shell assigns `window.global.__ENV` before the widget bundle runs
 * (see `apps/web/src/routes/feedback-widget/$organizationId.ts`). Declaring it
 * here is what lets `lib/api.ts` read the boot contract without the
 * `@ts-expect-error` casts the hand-written globals used to need.
 */
declare var global: { readonly __ENV?: unknown } | undefined;
