# Migrating `apps/web` to TanStack Start — and keeping the widget Solid-only

Researched 2026-09-22. All TanStack Start facts are pinned to the versions below; source line references point at the TanStack/router commit checked out for this research.

## Verified against

| Thing | Version verified | Notes |
| --- | --- | --- |
| `@tanstack/react-start` | **1.168.57** (published 2026-09-21T20:25:31Z) | `latest` dist-tag; `pre` = 1.168.33-pre.0 |
| `@tanstack/solid-start` | **1.168.55** (published 2026-09-21T20:26:53Z) | `latest`; `rc` = 2.0.0-rc.8 (2026-09-17) |
| `@tanstack/start-plugin-core` | 1.171.47 (2026-09-21T20:26:54Z) | shared Vite plugin for all flavors |
| `@tanstack/start-client-core` / `start-server-core` | 1.170.32 / 1.169.37 |  |
| `@tanstack/react-router` / `solid-router` | 1.170.38 / 1.170.36 | repo has react-router 1.170.27 |
| TanStack/router source | `main` @ `fe7f1fd0e6ef73c3f341dd2338b406749538a85d` (2026-09-21) | shallow clone, `git log -1` |
| Vite | 8.3.0 is `latest`; **all builds measured on 8.2.1** (repo version) | Start peer range is `>=7.0.0` |
| React / solid-js | 19.2.8 / 1.9.14 (repo), 19.3.0 / 1.9.15 (npm latest) |  |
| `@cloudflare/vite-plugin` | 1.54.9 (repo), 1.57.2 (latest) |  |
| Astro (status quo) | 7.3.2 (repo), 7.3.3 (latest) |  |
| effect | repo `4.0.0-rc.112`; npm `rc` = 4.0.0-rc.117, `latest` = 3.22.2 |  |
| Node | measured on v26.7.0; Start engines `>=22.12.0` |  |

Measurement apps were scaffolded under `/tmp/start-measure/` and deleted after the numbers below were recorded. Nothing was installed or written inside this repo.

---

## TL;DR

**1. Is TanStack Start ready, and does the Solid flavor exist?** Yes. `@tanstack/solid-start` 1.168.55 is a first-class flavor: it ships in the same release train as React (both cut from the 2026-09-21 release), has its own packages, docs section, examples and 21 e2e suites (including `basic-cloudflare`, `server-routes`, `spa-mode`, `selective-ssr`). It is not deprecated. The 2.0.0-rc line is Solid 2.0 support (solid-js `^2.0.0-rc.8`, `@solidjs/web`), not a Start 2.0, and is not production-ready. Vite 8 is supported: peer range `vite >=7.0.0`, and the repo's own examples/e2e pin `vite ^8.0.14`. I built Start apps with Vite 8.2.1 on Node 26.7.0 successfully, React and Solid. **There is no official "migrate from Astro" guide** — the only migration guide is from Next.js.

**2. Would a Start route for the iframe ship React?** Yes, if the route is a normal (React) route: a React Start app has exactly one client entry, and it is React + react-dom + react-router + Start's hydration runtime. Measured: 302.7 KiB raw / 96.3 KiB gzip for every SSR'd React route, including `/feedback-widget/$organizationId`. But you are not forced to use a normal route for the iframe.

**3. How do you keep the widget Solid-only, and is a separate app needed?** **No separate app is required — only a separate build.** A **server-only route** (`createFileRoute` with only a `server` prop) is pruned from the client route tree, produces no client chunk, and can return a hand-written HTML document. That document can load an independently built Solid bundle served as a static asset from the same deployment. Measured: that page contains **zero Start/React scripts**; only the Solid bundle. The Solid bundle (built from the real widget sources with Vite 8.2.1 + vite-plugin-solid 2.11.12) is **98.0 KiB raw / 37.8 KiB gzip**, versus the status-quo Astro iframe at **105.0 KiB raw / 41.4 KiB gzip** — i.e. the migration can hold the iframe payload flat and keep React out. The one hard constraint is that Start's client environment must have **exactly one entry** (its own plugin throws on a second one), so the widget must be its own Vite build/config — not a second input in the Start build.

---

## 1. State of TanStack Start today

### 1.1 Package set and channels

`@tanstack/react-start@latest` = 1.168.57; it depends on `start-client-core@1.170.32`, `start-plugin-core@1.171.47`, `start-server-core@1.169.37`, `react-router@1.170.38`, `react-start-client@1.168.36`, `react-start-server@1.167.43`, and `react-start-rsc@0.1.56`. `@tanstack/solid-start@latest` = 1.168.55 with the same core versions and `solid-router@1.170.36` (`npm view … peerDependencies dependencies engines`). Both declare `engines.node >= 22.12.0` and peer `vite: ">=7.0.0"`.

The `packages/` directory at `fe7f1fd` contains, side by side: `react-start`, `react-start-client`, `react-start-server`, `react-start-rsc`, `solid-start`, `solid-start-client`, `solid-start-server`, `vue-start`, `vue-start-client`, `vue-start-server` (<https://github.com/TanStack/router/tree/main/packages>).

`examples/` has 51 Solid examples and 59 React examples, including `examples/solid/start-basic`, `start-basic-cloudflare`, `start-basic-static`, `start-basic-auth`, `start-basic-nitro`, `start-i18n-paraglide`, `start-tailwind-v4`, `start-counter`. `e2e/solid-start/` has 21 suites (`basic`, `basic-cloudflare`, `server-routes`, `spa-mode`, `selective-ssr`, `streaming-ssr`, `deferred-hydration`, `start-manifest`, `css-modules`, `basic-auth`, `csp`, …) versus 42 for `e2e/react-start` (`gh api search/code`, `per_page=100`).

### 1.2 Is Solid supported, experimental, or deprecated? (addendum a)

**Fully released, documented, and tested; not deprecated.** Evidence:

- Published in lockstep with React and Vue: GitHub release `release-2026-09-21-2024` lists `@tanstack/react-start@1.168.57`, `@tanstack/solid-start@1.168.55`, `@tanstack/vue-start@1.168.54` and `@tanstack/start-plugin-core@1.171.47` (`gh api repos/TanStack/router/releases`).
- Docs: `docs/start/framework/solid/{overview,getting-started,build-from-scratch}.md` and the whole `docs/start/framework/solid/guide/**` tree, served at <https://tanstack.com/start/latest/docs/framework/solid/overview>. The docs `config.json` declares frameworks `["react", "solid"]` (Vue has packages but no Start docs pages yet).
- The CLI path is documented: `npx @tanstack/cli@latest create --framework solid` (`docs/start/framework/solid/getting-started.md`).
- The repo runs dedicated Solid e2e suites (list above), including Cloudflare.

Caveats worth knowing:

- The Solid docs pages are **generated from the React pages** via a front-matter `ref`/`replace` block (e.g. `docs/start/framework/solid/overview.md` is 7 lines that substitute `@tanstack/react-start` → `@tanstack/solid-start` and `react-router` → `solid-router`). Solid gets less bespoke prose than React.
- Solid's e2e surface is smaller than React's (21 vs 42 suites); the paraglide **e2e** suite exists under `e2e/react-start/i18n-paraglide`, though a Solid paraglide **example** exists (`examples/solid/start-i18n-paraglide`) and it builds the plugin the same way.

### 1.3 The 2.0.0-rc line (addendum d)

`@tanstack/solid-start@2.0.0-rc.8` (2026-09-17) and `@tanstack/solid-router@2.0.0-rc.8` are **Solid 2.0** support, not a Start API reset:

- peers: `solid-js: ">=2.0.0-0 <3.0.0"` and `@solidjs/web: ">=2.0.0-0 <3.0.0"`; `@tanstack/solid-start-server@2.0.0-rc.8` depends on `@tanstack/solid-router@2.0.0-rc.8`.
- release notes for rc.8: "Bump solid-js and @solidjs/web to ^2.0.0-rc.8 and @solidjs/vite-plugin to ^3.0.0-next.43 … rc.8 is ESM-only and declares `engines.node >= 22.12`. @solidjs/vite-plugin 3.0.0-next.43 is the first release that honors `resolve.noExternal` patterns…" (`gh api repos/TanStack/router/releases/tags/@tanstack/solid-start@2.0.0-rc.8`).
- Solid 2 itself is `next` = 2.0.0-rc.9 on npm. React has **no** 2.x release at all (`npm view @tanstack/react-start versions` → no `2.*`).
- Vite peer is still `>=7.0.0`, but the toolchain is different (`@solidjs/vite-plugin` 3.x instead of `vite-plugin-solid` 2.x) and this repo is on solid-js 1.9.14.

**Recommendation: do not use the 2.0.0-rc line.** It is an RC of an RC, requires a Solid major upgrade, and is not what the docs describe.

### 1.4 Vite majors supported (and is Vite 8.2.1 workable?)

Yes. Peer dependency of `@tanstack/react-start@1.168.57`, `@tanstack/solid-start@1.168.55` and `@tanstack/start-plugin-core@1.171.47`: `"vite": ">=7.0.0"` (satisfied by 8.x). `@tanstack/router-plugin@1.168.40` is explicit: `"vite": ">=5.0.0 || >=6.0.0 || >=7.0.0 || >=8.0.0"`. TanStack's own `examples/solid/start-basic` and `e2e/solid-start/basic` pin `vite: "^8.0.14"`, and `e2e/solid-start/basic-cloudflare` uses `@cloudflare/vite-plugin ^1.29.0` with it. Empirically: I built a React Start app and a Solid Start app with **vite 8.2.1** (this repo's exact version) on Node 26.7.0, both successfully; Vite 8 is the rolldown-based line, and Start sets both `rollupOptions` and `rolldownOptions` for every environment (`packages/start-plugin-core/src/vite/planning.ts:64-70,92-96`), so it is rolldown-aware.

### 1.5 Can one Start app mix React and Solid routes? (addendum b)

**No.** The flavor is fixed per plugin instance/app, not per route:

- `tanstackStart()` resolves `corePluginOpts.framework` (`'react'` / `'solid'` / `'vue'`) and derives `startPackageName = \`@tanstack/${framework}-start\``and`defaultEntryPaths` (`packages/react-start/src/plugin/vite.ts:24-40`, `packages/solid-start/src/plugin/vite.ts`; entry resolution in `packages/start-plugin-core/src/resolve-entries.ts`).
- There is exactly **one** client entry for the whole app: `createViteConfigPlan` sets `environments.client.build.rollupOptions.input = { index: <client entry> }` (`packages/start-plugin-core/src/vite/planning.ts:61-70`), and the manifest plugin throws `multiple entries detected: …` if the client build emits more than one entry chunk (`packages/start-plugin-core/src/vite/start-manifest-plugin/normalized-client-build.ts:49-52`).
- The docs say it plainly: "Astro composes runtimes, Start schedules one. That is why Start gets `interaction()`, `condition()`, and intent bubbling, and why Astro gets multi-framework." (`docs/start/framework/react/guide/deferred-hydration.md:92-105`, <https://tanstack.com/start/latest/docs/framework/react/guide/deferred-hydration>).

What _is_ possible in one Vite config: React and Solid plugins coexisting with disjoint `include`/`exclude` filters (Vite 8 also has `applyToEnvironment`). I built a two-entry config with `@vitejs/plugin-react` + `vite-plugin-solid` and `input: { react: 'react.html', widget: 'widget.html' }`: `dist/widget.html` loaded only `widget-*.js` (9.21 kB, no React) and `dist/react.html` loaded only `react-*.js` (189.75 kB, contains react-dom). That is how Astro does it today — but Start only uses one of those entries as its client entry, so this only helps for the separate widget build.

### 1.6 Scope of a separate Solid Start app (addendum c)

If you did make the widget its own `@tanstack/solid-start` app, the flavor supports the same features: server routes (`e2e/solid-start/server-routes`), request middleware (`createMiddleware`, `packages/start-client-core/src/createMiddleware.ts`), Cloudflare Workers (`examples/solid/start-basic-cloudflare` + `e2e/solid-start/basic-cloudflare`, using `cloudflare({ viteEnvironment: { name: 'ssr' } })`), and third-party Vite plugins (paraglide in `examples/solid/start-i18n-paraglide`, tailwind in `examples/solid/start-tailwind-v4`; the icons spritesheet plugin is an ordinary Vite plugin and works anywhere Vite runs — it is used today in both the Astro config and the widget's own Vite config).

The cost is payload: see §2.3. A Solid Start widget route loads Start's client entry (135.7 KiB raw / 46.2 KiB gzip measured) on top of the Solid runtime, because Start always hydrates the whole document through its single client entry.

---

## 2. Client bundle composition of a Start route

### 2.1 Source of truth

The React flavor's default client entry is `packages/react-start/src/default-entry/client.tsx`:

```tsx
hydrateRoot(
  document,
  <StrictMode>
    <StartClient />
  </StrictMode>
);
```

The Solid flavor's is `packages/solid-start/src/default-entry/client.tsx` (`hydrateStart().then((router) => hydrate(() => <StartClient router={router} />, document))`). Both are the single client entry configured by the Start plugin. The client build has **no HTML input at all** — Start's server generates the document at request time and injects modulepreloads / the client script for the matched route.

### 2.2 Measured — throwaway React Start app

App: `src/routes/__root.tsx`, `index.tsx`, `feedback-widget.$organizationId.tsx` (React route), plus a server-only route `widget-html.ts`; `vite 8.2.1`, `react 19.2.8`, `@tanstack/react-start 1.168.57`. `vite build` output (client environment):

```
dist/client/assets/routes-Dz4UzTPl.js                           147 B
dist/client/assets/feedback-widget._organizationId-DU7Q23jl.js  208 B
dist/client/assets/index-Y0o7gZ_E.js                         309,578 B  (Vite gzip: 99.99 kB)
```

No `index.html` is emitted; `dist/client` contains only assets (+ copied `public/`). `grep 'react-dom/client' dist/client/assets/index-*.js` matches, i.e. React is inside the single client entry. Serving the build (`vite preview`) and fetching routes:

| Request | Scripts in the document | JS payload (raw / gzip -9) |
| --- | --- | --- |
| `GET /` | modulepreload `index-…js` + `routes-…js` | 302.7 KiB / 96.3 KiB |
| `GET /feedback-widget/org123` | modulepreload `index-…js` + `feedback-widget…js` | 302.7 KiB / 96.3 KiB |
| `GET /does-not-exist` | same client entry, HTTP **404** | 302.7 KiB / 96.3 KiB |
| `GET /widget-html` (server-only route) | **none** — only the hand-written `<script src="/solid-widget.js">` | 0 B from Start |

**Answer to question 2: yes.** Any normal client route in a React Start app ships React + react-dom + react-router + Start's hydration/serialization runtime. If `/feedback-widget/:org` were a React Start route, the iframe payload would grow from today's 105.0 KiB raw / 41.4 KiB gzip to 302.7 KiB raw / 96.3 KiB gzip and would include React.

### 2.3 Measured — Solid flavor, and the status-quo baseline

Same routes in a `@tanstack/solid-start 1.168.55` app (`solid-js 1.9.15`, `vite-plugin-solid 2.11.12`, `vite 8.2.1`):

```
dist/client/assets/routes-DFbU7YFr.js                          131 B
dist/client/assets/feedback-widget._organizationId-BV8g7qI8.js  295 B
dist/client/assets/index-CTcZbnrt.js                        138,996 B  (Vite gzip: 47.85 kB)
```

Closure from the entry (following static + `__vite__mapDeps` + dynamic imports), gzip -9:

| Scenario | Chunks | JS raw | JS gzip | React in closure |
| --- | --- | --- | --- | --- |
| **Status quo — Astro iframe** (`apps/web/dist/client/_astro`, build 2026-09-22 13:41, closure from `main.XXpeB0GG.js`) | 15 | **105.0 KiB** | **41.4 KiB** | **no** |
| Widget as a **plain Vite + Solid build** (real `packages/feedback-widget` sources copied to /tmp, `index.html` entry, Vite 8.2.1 + vite-plugin-solid 2.11.12) | 7 | **98.0 KiB** | **37.8 KiB** | **no** |
| Widget as a **Solid Start route** (`solid-start` app above) | 3 | **136.2 KiB** | **46.6 KiB** | no |
| Widget as a **React Start route** (React app above) | 3 | **302.7 KiB** | **96.3 KiB** | **yes** |

CSS: status quo `_organizationId_.DyK4xsvj.css` = 69,909 B / 10,913 B gzip; the standalone Solid build of the same sources = 70.42 kB / 11.01 kB gzip (same CSS, confirming the build is representative). Initial-load JS (entry + eagerly referenced chunks only) for the standalone build is 88.5 kB raw / 34.2 kB gzip; the rest is lazy route chunks.

Interpretation: the standalone Solid build is _slightly smaller_ than today's Astro closure because Astro's `manualChunks` puts shared code in `dist.DuucfX67.js` (25.9 KiB, part of the widget closure); the Solid Start route costs **+31 KiB raw / +5.2 KiB gzip** over today; the React Start route costs **+198 KiB raw / +55 KiB gzip** and drags React into the iframe.

---

## 3. Can one TanStack Start app host a Solid (non-React) page without shipping React?

### 3a. Server-only routes — **yes, and this is the mechanism**

Server routes are `createFileRoute` objects with a `server` property (<https://tanstack.com/start/latest/docs/framework/react/guide/server-routes>). A route whose only `createFileRoute` prop is `server` is **pruned from the client route tree**:

- `packages/start-plugin-core/src/start-router-plugin/pruneServerOnlySubtrees.ts:41-48` — a node is dropped when `createFileRouteProps` has only `server` and all children are server-only.
- `packages/start-plugin-core/src/vite/start-router-plugin/plugin.ts:95` — the plugin that serves the pruned tree is `applyToEnvironment: (env) => env.name === 'client'`, so only the client tree is pruned; the server tree still imports the file.
- `…/plugin.ts:166` — the client code-splitter additionally uses `deleteNodes: ['ssr', 'server', 'headers']`.

Measured proof: `src/routes/widget-html.ts` (only `server.handlers.GET` returning a hand-written HTML string) produced **no client chunk**; the strings `widget-html` and the HTML body do not appear in any `dist/client/assets/*.js`; `GET /widget-html` returned exactly the hand-written document with no Start scripts, and the referenced `/solid-widget.js` was served from the copied `public/` directory.

Also relevant: Start's prerenderer just requests each configured path from the built server and writes the response body to a file in the client output dir (`packages/start-plugin-core/src/prerender.ts:193,212`), so a server route's HTML can be snapshotted to a static asset for known paths. For the widget the org id is dynamic, so serving it per request (or prerendering per tenant, not viable) is the realistic shape.

### 3b. `spa` / `ssr: false` / custom shells — **no, they do not avoid the framework client entry**

- `ssr: false` per route and `defaultSsr: false` disable server rendering/loaders but the client still hydrates through Start's single client entry (<https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr>).
- SPA mode prerenders the root shell and rewrites 404s to `/_shell.html`; that shell still loads the framework client entry (<https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode>).
- A custom `shellComponent` on the root route / custom `src/server.ts` handler still renders through the router and therefore through the client entry (<https://tanstack.com/start/latest/docs/framework/react/guide/server-entry-point>).

The only route kind that is excluded from the client graph is the server-only route above.

### 3c. Second HTML entry in the client build — **blocked by Start, workable as a separate build**

- Adding `environments.client.build.rollupOptions.input = { widget: 'widget.html' }` next to Start's `index` entry **fails the build** with `Error: multiple entries detected: assets/index-….js assets/widget-….js` from `packages/start-plugin-core/src/vite/start-manifest-plugin/normalized-client-build.ts:49-52` (reproduced exactly in `/tmp/start-measure/react-app-2`). This is a hard invariant, not a warning.
- Start also empties the client outDir on every build (measured: a probe file placed in `dist/client` was gone after the next `vite build`). So a widget build that writes into `dist/client` must run **after** Start's build, or write somewhere that the deploy step merges.
- Cloudflare: `@cloudflare/vite-plugin` (repo 1.54.9, latest 1.57.2) "determines whether assets should be included based on whether the `client` environment has been built" and populates `assets.directory` from the client build output automatically; it explicitly supports "importing from the `public` directory" and all of Vite's static-asset handling (<https://developers.cloudflare.com/workers/vite-plugin/reference/static-assets/, last updated 2026-08-18>). So a Solid bundle placed in `public/` (or copied into the client outDir after the Start build) is uploaded and served by the same Worker. (Multiple HTML entries are a normal Vite feature — I built two in one Vite config, §3d — but whether the Cloudflare plugin deploys each as a static asset is UNVERIFIED here; it is moot anyway because Start rejects the second client entry.)

### 3d. React and Solid Vite plugins in one config — **yes**

Verified by build: one Vite config with `@vitejs/plugin-react` and `vite-plugin-solid` using disjoint `include`/`exclude` filters produced `dist/widget.html` → `widget-*.js` (9.21 kB, no React) and `dist/react.html` → `react-*.js` (189.75 kB, react-dom present), with no cross-contamination. This repo already relies on the same pattern through `@astrojs/react`/`@astrojs/solid-js` include/exclude regexes. Vite 8 additionally supports `applyToEnvironment` for per-environment plugin application, but for the widget a separate build is cleaner than per-environment config, because Start's client environment can only ever have one entry (3c).

### 3e. If you prefer a separate Solid Start app instead of a separate build

`@tanstack/solid-start` 1.168.55 (same release train as React, see §1.2) supports the same server routes, `createMiddleware` request middleware, Cloudflare Workers target and third-party Vite plugins (paraglide/tailwind/icons-spritesheet) that this repo needs — see §1.6 for the evidence paths. The difference is payload: a widget route in a Solid Start app loads Start's client entry on top of Solid (136.2 KiB raw / 46.6 KiB gzip measured, §2.3), i.e. **+31 KiB raw / +5.2 KiB gzip** over today's Astro iframe, for hydration/serialization features a `HashRouter` SPA does not use. Full comparison in §4.1.

---

## 4. Do we need a separate app?

**No. A separate app is not required — a separate entry/build is.** Recommendation: **Option B**, with the widget's HTML shell served by a server-only route and the Solid bundle built by the widget's own Vite config (already present at `packages/feedback-widget/vite.config.ts`) and served from the same deployment's static assets.

| Option | What it is | Payload for the iframe | Cross-origin/cookies | Deploy/ops | Verdict |
| --- | --- | --- | --- | --- | --- |
| **A. Separate app/worker** | Keep the widget as today's own Vite+Solid build, deployed to its own worker/site; SDK iframe URL points there | 98.0 KiB raw / 37.8 KiB gzip | Becomes cross-site in production; dev needs the parent's `/api` proxy to stay same-origin, and SSO/postMessage need `hostOrigin` (already handled by `packages/sdk/src/iframe.ts`) | Second deploy target, second wrangler config, SDK `resolveBaseUrl` default (`https://app.feeblo.com`) must change | Works, but the only thing it buys is independent deploy cadence |
| **B. Same app, second build** (recommended) | Start app + server-only route returning the widget HTML shell; Solid bundle from `packages/feedback-widget` build served as a static asset; one worker, one origin | 98.0 KiB raw / 37.8 KiB gzip, zero React | Unchanged — same origin, `/api` dev proxy and cookies behave exactly as today | Two build steps with ordering (`vite build` then widget build with `emptyOutDir: false`, or build into `public/` first); widget dev server (port 5174) already exists | **Recommended** |
| **C. Full Start, widget in React** | Rewrite the widget as React routes inside the dashboard app | 302.7 KiB raw / 96.3 KiB gzip (+198 KiB raw / +55 KiB gzip vs today) and React enters the iframe | Simplest hosting/dev story | Rewrite of 30+ Solid components/routes, loses the "lighter iframe" property that motivated Astro | Rejected |
| **D. Hybrid: Astro for the widget, Start for the dashboard** | Two apps (or one app with two servers), iframe path stays in Astro | Unchanged (105.0 KiB / 41.4 KiB) | Unchanged | Two frameworks/builds/deploys to maintain; `s/[...subDomain]` public board and middleware would need to split too | Only if the dashboard migration is wanted and the widget path must not move |

What actually breaks (or doesn't) in Option B:

- **Cookies/SSO:** nothing — the iframe stays on the same origin as the dashboard, so the widget's `fetch` to `/api/...` is same-origin exactly as today. `docs/widget-sso.md` is unaffected.
- **Dev `/api` proxy:** unaffected. Vite registers `server.proxy` **before** post-phase `configureServer` hooks (Vite 8 `node_modules/vite/dist/node/chunks/node.js:26567` vs `postHooks.forEach(...)` at 26582), and Start installs its dev SSR middleware in the returned post hook (`packages/start-plugin-core/src/vite/dev-server-plugin/plugin.ts:116,161`). So the existing proxy/rewrite in `astro.config.mjs` moves into `vite.config.ts` verbatim.
- **Height `postMessage`:** unchanged (it lives in the widget shell HTML; it moves from the `.astro` page's inline script into the server route's HTML string).
- **CSP/sandbox:** unchanged; `packages/sdk/src/iframe.ts` keeps setting `sandbox` and `allow`.
- **New work:** the widget shell becomes an HTML template in a server route (instead of `FeedbackWidgetLayout.astro`), and `EnvScript`'s `window.global.__ENV` injection becomes a per-request `process.env` read in that route (the widget reads `window.global.__ENV.organizationId` / `API_URL` / `widgetConfig` — `packages/feedback-widget/src/lib/api.ts:41,47`, `…/lib/config.ts:23-25`).

### 4.1 Addendum: "widget as its own Solid Start app" vs "plain Vite+Solid SPA on static assets"

|  | Solid Start app for the widget | Plain Vite+Solid build served as a static asset (Option B) |
| --- | --- | --- |
| Initial JS (measured) | 136.2 KiB raw / 46.6 KiB gzip | 98.0 KiB raw / 37.8 KiB gzip |
| What the extra ~38 KiB buys | Start's hydration runtime, seroval serialization, router integration, server functions | nothing the widget uses — it is a `HashRouter` SPA with no SSR/data-loading needs (`packages/feedback-widget/src/main.tsx`) |
| Complexity | second Start app (routes, root route, build, deploy, CF config) | second Vite config (already exists) + one server route in the main app |
| Dev | Start dev server + second app | existing widget dev server on 5174, proxied or pointed at by the iframe |

A Solid Start app is the right shape only if the widget grows server-rendered pages or server functions of its own. Today it does not.

---

## 5. Migration surface inventory

| Astro feature used here | Start equivalent | Notes / citation |
| --- | --- | --- |
| `src/pages/**` file-based pages | `src/routes/**` file-based routes | `router.routesDirectory` is configurable (`packages/start-plugin-core/src/schema.ts:214-219`, `tsrConfig` from `@tanstack/router-plugin`) — the existing `src/dashboard/routes` can stay put |
| `src/layouts/*.astro` | root route `shellComponent` + pathless layout routes (`_dashboard-layout.tsx` already is one) | <https://tanstack.com/start/latest/docs/framework/react/guide/routing> |
| `[...page].astro` catch-all | `src/routes/$.tsx` splat route | router file-naming conventions |
| `src/pages/s/[...subDomain].astro` | `src/routes/s/$.tsx` (or `s/$subDomain.tsx`) with `loader` + `head()` | public board SSR + JSON-LD + React island becomes one SSR route; the React island stops being an island and is just the route component |
| `client:only="react"` islands | nothing equivalent — every route is client-hydrated | docs: "Astro composes runtimes, Start schedules one" (`guide/deferred-hydration.md:92-105`). Fine for the dashboard, which is already a full client app |
| `src/middleware.ts` (`sequence(localeMiddleware, subdomainMiddleware)`) | `src/start.ts` `createStart(() => ({ requestMiddleware: [...] }))` + custom `src/server.ts` | `createMiddleware` is exported from `@tanstack/start-client-core` (present since at least 1.115.0, verified in the published `dist/esm/index.d.ts`; re-exported by `@tanstack/react-start` 1.168.57). Docs: <https://tanstack.com/start/latest/docs/framework/react/guide/middleware>. **No `context.rewrite`** — see risks |
| `context.locals.subdomain` / `publicPath` | router context from a `beforeLoad`/middleware, or request headers in server routes | server routes receive `request`; middleware can attach context |
| `output: "server"` + `export const prerender = false` | SSR is the default; `prerender`/`pages` opts in | <https://tanstack.com/start/latest/docs/framework/react/guide/static-prerendering> |
| `envField` schema (`astro.config.mjs`) | `process.env` read per request + a zod validator | Start docs are explicit: on Workers, read env per request, never at module scope (<https://tanstack.com/start/latest/docs/framework/react/guide/environment-variables>) |
| `EnvScript.astro` runtime env injection | server route/root `loader` reading `process.env` and emitting an inline script, or `cloudflare:workers` `env` | same docs section; this replaces `getPublicEnvServer()` (`apps/web/src/dashboard/lib/server-runtime-public-env.ts`) |
| `@astrojs/rss` | hand-written server route | no RSS helper in Start; the existing `rss.xml.ts` already builds XML manually and can be moved nearly verbatim |
| `robots.txt.ts` / `sitemap.xml.ts` | server routes | Start has a built-in sitemap generator, but only for prerendered pages and a single `host` (`schema.ts:263-268`) — it cannot express per-subdomain hosts, so keep the hand-written routes |
| `@astrojs/solid-js` | not needed; `vite-plugin-solid` only in the widget's own build |  |
| `@astrojs/cloudflare` + `wrangler.jsonc` | `@cloudflare/vite-plugin` + Start's Cloudflare guide | `cloudflare({ viteEnvironment: { name: 'ssr' } })`, `wrangler.jsonc` `main: "@tanstack/react-start/server-entry"`, `compatibility_flags: ["nodejs_compat"]`; assets dir auto-populated (<https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/>, updated 2026-09-04; <https://tanstack.com/start/latest/docs/framework/react/guide/hosting>) |
| `@astrojs/node` (standalone, non-CF path) | Start Node/Docker via nitro/srvx (`node .output/server/index.mjs`) | <https://tanstack.com/start/latest/docs/framework/react/guide/hosting> |
| Paraglide Vite plugin + `paraglideMiddleware` | unchanged plugin; middleware moves into `src/server.ts` wrapping `handler.fetch` | <https://tanstack.com/router/latest/docs/framework/react/guide/internationalization-i18n>; Solid example `examples/solid/start-i18n-paraglide` |
| `fontProviders.google()` + `<Font />` | `@fontsource*` packages or self-hosted `@font-face` | Astro's font pipeline is Astro-only; Start has no equivalent |
| `astro-seo` `<SEO />` | route `head()` returning meta/link arrays | <https://tanstack.com/start/latest/docs/framework/react/guide/seo> |
| `astro check` | `tsc --noEmit` | every Start example's build script is `vite build && tsc --noEmit` |
| `vite.rolldownOptions.output.manualChunks` | same option in the client environment build | Start writes `rolldownOptions`/`rollupOptions` per environment (`planning.ts:64-96`); a top-level `build.rolldownOptions.output.manualChunks` is inherited |
| `vite.build.chunkSizeWarningLimit`, `ssr.noExternal` | unchanged | Start's `createViteConfigPlan` merges `resolve.noExternal` with `@tanstack/start**` entries (`planning.ts:105-113`) |
| `autoCodeSplitting: true` | automatic | `autoCodeSplitting` is omitted from Start's router schema; Start always installs its client+server code splitters (`vite/start-router-plugin/plugin.ts:148-190`) |
| Astro "migrate from" guide | **does not exist** | the only migration doc is `docs/start/framework/react/migrate-from-next-js.md`; a repo-wide grep for "astro" in Start docs only hits the deferred-hydration comparison |

---

## 6. Incompatibilities and risks for this repo

**Green (verified):**

- Node 26.4/26.7 vs Start `engines.node >= 22.12.0` — fine; measured builds ran on v26.7.0.
- Vite 8.2.1 — supported and exercised; the repo's `rolldownOptions`/manualChunks style is already what Start uses internally.
- React 19.2.8 — peer `>=18.0.0 || >=19.0.0`; `@tanstack/react-router` 1.170.27 → 1.170.38 is a patch-line upgrade. `@effect/atom-react` (peer react >=19 <20), `@tanstack/react-db` (peer react >=16.8), `@base-ui/react`, `@tanstack/react-query`, dnd-kit and posthog-js are ordinary client libraries; none are Start-aware and none should care.
- TanStack DB: client-only collection store; keep it inside route components/loaders as today.
- Cloudflare Workers: `nodejs_compat` is already set in `wrangler.jsonc`; the CF guide requires it. Effect 4 RC runs on Workers today through the existing server app; the dashboard only consumes the RPC client (fetch), so nothing Node-specific needs to move into the Worker. (UNVERIFIED: no first-party statement that Start + Effect 4 RC on Workers is tested together; this is inference from the existing setup.)
- Dev cookie/first-party `/api` proxy — works unchanged (proxy middleware precedes Start's dev middleware; see §4).
- Paraglide — same Vite plugin, middleware moves to the server entry.
- 404s: an unmatched path returns HTTP 404 with the SSR shell (measured); a server route can return any status.
- Height `postMessage`, iframe sandbox, SSO contract — untouched.

**Yellow (needs design work):**

- **Subdomain routing.** Astro's `context.rewrite()` (used in `apps/web/src/middleware.ts`) has no Start equivalent. The closest mechanisms are (a) a 302 redirect, or (b) a custom `src/server.ts` `createServerEntry({ fetch })` that constructs a new `Request` with a rewritten URL before delegating to `handler.fetch` (the entry is a plain fetch handler: <https://tanstack.com/start/latest/docs/framework/react/guide/server-entry-point>). The `publicPath` bookkeeping (`context.locals.publicPath`, used for canonical URLs and JSON-LD) must be carried through router context instead of `Astro.locals`.
- **The widget shell.** It moves from `.astro` layouts to an HTML string in a server route; the icon sprite (`?raw` import), inline styles, and env injection must be assembled there. Vite's `?raw` import of the sprite still works in the server build.
- **Two-step build ordering.** Start empties `dist/client` on every build (measured). Options: build the widget into `public/widget/` before the Start build (Vite copies `public/` into the client output), or run the widget build after Start's with `emptyOutDir: false`. The current `packages/feedback-widget/vite.config.ts` `build.lib` externals (`solid-js`, `@solidjs/router`) would have to be dropped for the iframe build — the iframe has no import map to provide them (the current externals are only meaningful for a consumer that supplies them; nothing in the repo consumes `dist/`).
- **Widget dev loop.** Start's client env cannot mount a Solid component, so the widget must keep its own Vite dev server (port 5174 already configured) and the Start dev server should proxy `/feedback-widget` to it, or the iframe should point at `http://localhost:5174` in dev.
- **Effect RPC and per-request env.** `getPublicEnvServer()` uses `astro:env/server`; replacing it means reading `process.env` per request in server routes/middleware (Workers inject env at request time). Module-scope reads silently produce `undefined` on Workers — called out explicitly in Start's env docs.
- **Fonts.** Inter/Geist Mono currently come from Astro's font pipeline with preload control; the migration needs `@fontsource-variable/inter` + `@fontsource/geist-mono` (or self-hosted files) and manual preload links in the root route.

**Red / hard constraints:**

- **One client entry per app.** A second HTML/JS entry in the Start client environment fails the build (`normalized-client-build.ts:49-52`). The widget must be a separate build; it cannot be a second entry of the Start app.
- **No multi-framework routes.** React and Solid cannot coexist as routes in one Start app (`framework` is fixed per plugin; docs say Astro is the multi-framework one).
- **No `client:only` equivalent.** Any React Start route ships the full React client entry (302.7 KiB / 96.3 KiB gzip measured). This is acceptable for the dashboard (it already ships React) but fatal for the iframe — hence the server-route escape hatch.
- **Start docs describe React/Solid 1.x only.** The 2.0.0-rc line changes the Solid toolchain (`@solidjs/vite-plugin` 3.x, ESM-only) and should be avoided until GA.

---

## 7. Effort estimate

Grounded in the inventory above; "risky" = requires new design, "mechanical" = copy/rename/config.

| Workstream | Size | Notes |
| --- | --- | --- |
| Dashboard routes (45 files under `src/dashboard/routes`, already TanStack Router file-based, `autoCodeSplitting`) | 1–2 days, mechanical | Point `router.routesDirectory` at the existing dir; delete `main.tsx`'s `createRoot`/`RouterProvider` in favour of Start's client entry; add `__root.tsx` shell. Components/hooks untouched |
| App shell: 6 layouts + `CommonHead`/`ThemeScript`/`LocaleScript`/`EnvScript` | 1 day, low risk | `head()` for SEO/meta/preconnect, inline scripts in the root shell, env injection per request |
| Middleware: paraglide locale + subdomain rewrite + `publicPath` | 1–2 days, **risky** | custom `src/server.ts` URL rewrite + `src/start.ts` request middleware; must reproduce `Astro.locals` semantics |
| Public board (`s/[...subDomain].astro`, ~300 lines of SSR metadata + JSON-LD + React island + SSR fallback) | 1–2 days, medium | loader-based data + `head()`; the React island becomes the route component |
| Endpoints: `robots.txt.ts`, `rss.xml.ts`, `sitemap.xml.ts` | 0.5 day, mechanical | `createFileRoute` + `server.handlers`; bodies can move almost verbatim |
| **Widget: server-only route shell + separate Solid build + dev wiring** | 1–3 days, medium | the only genuinely new architecture; also drop the unused `build.lib` externals or add a second widget build config |
| Env/config: `envField` → validated per-request env module; `wrangler.jsonc` main/assets; CF Vite plugin | 0.5 day, low risk | `nodejs_compat` already present |
| Fonts/SEO/icons | 0.5 day, low risk | `@fontsource`, `head()` meta, sprite `?raw` |
| Build/CI/deploy: turbo task, two-step build ordering, `main: "@tanstack/react-start/server-entry"` | 1 day, medium | must encode the ordering constraint (Start build vs widget build) |
| Typecheck/tests/e2e updates (`astro check` → `tsc`, playwright base URLs) | 1–2 days, low risk | e2e suite already points at port 3001 |
| **Total** | **~8–14 engineer-days** | Option B; a careful migration with the dashboard shipped first and the widget path migrated last |

Not in the estimate: the widget rewrite to React (Option C) — that is a multi-week rewrite of `packages/feedback-widget` and should be rejected on payload grounds alone.

Suggested sequencing: (1) port the dashboard (lowest risk, biggest win), (2) port middleware + public board + endpoints, (3) move the widget to the server-route + static-bundle shape last, behind the unchanged `/feedback-widget/:organizationId` URL, so the SDK and iframe contract never change.

---

## Measurement appendix (raw numbers)

All builds: Vite 8.2.1, Node 26.7.0, 2026-09-22. `gzip -9` in the tables below; "Vite gzip" is the size printed by the build. Closures follow static imports, `__vite__mapDeps` arrays and dynamic `import()` of `.js` chunks.

**React Start app** (`/tmp/start-measure/react-app`)

```
dist/client/assets/index-Y0o7gZ_E.js                           309,578 B (Vite gzip 99.99 kB)
dist/client/assets/routes-Dz4UzTPl.js                              147 B
dist/client/assets/feedback-widget._organizationId-DU7Q23jl.js     208 B
closure from index-Y0o7gZ_E.js: 3 chunks, 302.7 KiB raw, 96.3 KiB gzip, contains react-dom
GET /widget-html → HTTP 200, body is the hand-written HTML, only <script src="/solid-widget.js">
GET /solid-widget.js → HTTP 200 (served from public/ copy)
GET /does-not-exist → HTTP 404, still loads the React client entry
```

**Solid Start app** (`/tmp/start-measure/solid-app`)

```
dist/client/assets/index-CTcZbnrt.js                           138,996 B (Vite gzip 47.85 kB)
dist/client/assets/routes-DFbU7YFr.js                              131 B
dist/client/assets/feedback-widget._organizationId-BV8g7qI8.js     295 B
closure from index-CTcZbnrt.js: 3 chunks, 136.2 KiB raw, 46.6 KiB gzip, no React
```

**Widget standalone build** (`/tmp/start-measure/widget-copy`, real sources from `packages/feedback-widget`, `index.html` entry, externals removed)

```
dist-html/index.html                                              0.42 kB
dist-html/assets/widget-D8jJYzC7.js                             86.28 kB (Vite gzip 32.93 kB)
dist-html/assets/routes-DwBaMa_g.js                              1.37 kB
dist-html/assets/createAsync-HRPK3Bgw.js                          0.70 kB
dist-html/assets/updates-B2zcwlvo.js                              0.13 kB
dist-html/assets/board-nOGxdDxf.js                                7.32 kB
dist-html/assets/updates-list-B7H1h05s.js                         3.54 kB
dist-html/assets/update-detail-DzCME3lw.js                        1.01 kB
dist-html/assets/widget-Is17WDNN.css                            70.42 kB (Vite gzip 11.01 kB)
closure from widget-D8jJYzC7.js: 7 chunks, 98.0 KiB raw, 37.8 KiB gzip, no React
```

**Status quo baseline** (`apps/web/dist/client/_astro`, build 2026-09-22 13:41; walked from `main.XXpeB0GG.js`)

```
15 chunks, 105.0 KiB raw, 41.4 KiB gzip, no React
  solid-vendor.BG7wZSbL.js      49.8 KiB raw / 18.6 KiB gz
  dist.DuucfX67.js              25.9 KiB raw / 10.2 KiB gz
  board.DZMtsrWO.js              7.5 KiB raw /  2.8 KiB gz
  icon.0GpVJfE1.js               4.8 KiB raw /  1.4 KiB gz
  updates-list.Bh72IF-V.js       3.7 KiB raw /  1.7 KiB gz
  api.BzVYRzVe.js                3.0 KiB raw /  1.4 KiB gz
  main.XXpeB0GG.js               3.7 KiB raw /  1.8 KiB gz
  …plus 8 small chunks
_organizationId_.DyK4xsvj.css   69,909 B raw / 10,913 B gz
```

**Rejected experiment** (`/tmp/start-measure/react-app-2`): adding `environments.client.build.rollupOptions.input.widget = 'widget.html'` failed with `Error: multiple entries detected: assets/index-Y0o7gZ_E.js assets/widget-BSisQfW0.js` thrown from `@tanstack/start-plugin-core/dist/esm/vite/start-manifest-plugin/normalized-client-build.js:31`.

**Plugin-coexistence experiment** (`/tmp/start-measure/dual-plugin`): React + Solid plugins, two HTML entries, one build → `dist/widget.html` → `widget-BpMhPkMW.js` 9.21 kB (no React); `dist/react.html` → `react-Ethybe4_.js` 189.75 kB (react-dom present).

---

## Sources

**TanStack Start docs (versioned site + repo docs at `fe7f1fd`)**

- Solid overview — <https://tanstack.com/start/latest/docs/framework/solid/overview>
- Server routes — <https://tanstack.com/start/latest/docs/framework/react/guide/server-routes>
- Middleware — <https://tanstack.com/start/latest/docs/framework/react/guide/middleware>
- Selective SSR — <https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr>
- SPA mode — <https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode>
- Static prerendering — <https://tanstack.com/start/latest/docs/framework/react/guide/static-prerendering>
- Environment variables — <https://tanstack.com/start/latest/docs/framework/react/guide/environment-variables>
- Hosting (Cloudflare, Node/Docker) — <https://tanstack.com/start/latest/docs/framework/react/guide/hosting>
- Server entry point — <https://tanstack.com/start/latest/docs/framework/react/guide/server-entry-point>
- Deferred hydration / Astro comparison — <https://tanstack.com/start/latest/docs/framework/react/guide/deferred-hydration>
- i18n + Paraglide — <https://tanstack.com/router/latest/docs/framework/react/guide/internationalization-i18n>

**TanStack/router source (main @ `fe7f1fd0e6ef73c3f341dd2338b406749538a85d`)**

- `packages/start-plugin-core/src/vite/planning.ts:61-70,92-96,105-113` — single client entry, env builds, noExternal
- `packages/start-plugin-core/src/vite/start-manifest-plugin/normalized-client-build.ts:49-52` — multiple-entries error
- `packages/start-plugin-core/src/vite/start-router-plugin/plugin.ts:95,124,166` — client-only pruned route tree, `deleteNodes`
- `packages/start-plugin-core/src/start-router-plugin/pruneServerOnlySubtrees.ts:41-48` — server-only route pruning
- `packages/start-plugin-core/src/vite/dev-server-plugin/plugin.ts:116,161` — dev SSR middleware in the post hook
- `packages/start-plugin-core/src/vite/start-manifest-plugin/*` — client manifest assumptions
- `packages/start-plugin-core/src/prerender.ts:193,212` — prerender writes the server response to a file
- `packages/start-plugin-core/src/schema.ts:207-299` — `router.routesDirectory`, `client`, `server`, `pages`, `sitemap`, `prerender`, `spa`
- `packages/react-start/src/default-entry/client.tsx` — `hydrateRoot(document, <StartClient/>)`
- `packages/solid-start/src/default-entry/client.tsx` — `hydrate(() => <StartClient/>, document)`
- `packages/react-start/src/plugin/vite.ts:24-40`, `packages/react-start/src/plugin/shared.ts` — framework-fixed plugin, default entry paths
- `packages/start-client-core/src/createMiddleware.ts`, `…/src/index.tsx` — `createMiddleware`, `createStart` exports
- `examples/solid/start-basic{,-cloudflare,-static}/package.json`, `e2e/solid-start/basic/package.json` — `vite ^8.0.14`, `vite-plugin-solid ^2.11.11`
- `examples/solid/start-i18n-paraglide/vite.config.ts`, `examples/solid/start-basic-cloudflare/vite.config.ts`

**npm registry metadata** (queried 2026-09-22)

- `https://registry.npmjs.org/@tanstack/react-start` — dist-tags, `1.168.57` time, peers/deps
- `https://registry.npmjs.org/@tanstack/solid-start` — dist-tags (`latest 1.168.55`, `rc 2.0.0-rc.8`), publish times, peers/deps
- `https://registry.npmjs.org/@tanstack/start-plugin-core`, `…/start-client-core`, `…/start-server-core`
- `https://registry.npmjs.org/@tanstack/solid-router/2.0.0-rc.8`, `…/solid-start-client/2.0.0-rc.8`
- `https://registry.npmjs.org/vite`, `…/react`, `…/solid-js`, `…/effect`, `…/astro`, `…/@cloudflare%2Fvite-plugin`

**GitHub**

- Releases — `gh api repos/TanStack/router/releases` (`release-2026-09-21-2024`, `@tanstack/solid-start@2.0.0-rc.8`)
- Packages/examples/e2e listings — <https://github.com/TanStack/router/tree/main/packages>, `…/examples/solid`, `…/e2e/solid-start`

**Cloudflare**

- TanStack Start on Workers — <https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/> (updated 2026-09-04)
- Vite plugin static assets — <https://developers.cloudflare.com/workers/vite-plugin/reference/static-assets/> (updated 2026-08-18)

**Astro (status quo, for the mapping table)**

- On-demand rendering — <https://docs.astro.build/en/guides/on-demand-rendering/>
- Middleware — <https://docs.astro.build/en/guides/middleware/>
- Endpoints — <https://docs.astro.build/en/guides/endpoints/>
- Configuration (`envField`) — <https://docs.astro.build/en/reference/configuration-reference/>
- Solid integration / `client:only` — <https://docs.astro.build/en/guides/integrations-guide/solid-js/>
- Fonts — <https://docs.astro.build/en/guides/fonts/>
- Cloudflare adapter — <https://docs.astro.build/en/guides/integrations-guide/cloudflare/>

**This repo (read-only)**

- `apps/web/astro.config.mjs`, `apps/web/wrangler.jsonc`, `apps/web/package.json`
- `apps/web/src/middleware.ts`, `apps/web/src/layouts/{Layout,FeedbackWidgetLayout,EnvScript,CommonHead}.astro`
- `apps/web/src/pages/{[...page].astro,feedback-widget/[organizationId].astro,robots.txt.ts,s/[...subDomain].astro,s/[...subDomain]/{rss.xml,sitemap.xml}.ts}`
- `apps/web/src/dashboard/routes/**` (45 files), `apps/web/src/dashboard/main.tsx`
- `apps/web/src/dashboard/lib/server-runtime-public-env.ts`
- `packages/feedback-widget/{package.json,vite.config.ts,index.html,src/main.tsx,src/lib/api.ts,src/lib/config.ts}`
- `packages/sdk/src/iframe.ts`, `docs/widget-sso.md`
- `apps/web/dist/client/_astro` (status-quo build, 2026-09-22 13:41)
