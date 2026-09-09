# post-ui i18n

`@feeblo/post-ui` is the shared post/comment/auth UI used by the dashboard and the public board. It compiles from the shared root catalog with the `baseLocale` fallback strategy (Paraglide monorepo Pattern 1; see `docs/i18n/README.md`).

- Catalog: `project.inlang/` + `messages/{en,de,zh,es,fr,pt,ru,ar}.json` at the repo root.
- Generated (git-ignored): `packages/post-ui/src/paraglide/`.
- Import messages relatively (`../paraglide/messages.js` from `src/v2/*`, `../../paraglide/messages.js` from `src/v2/*/*`).

## Host injection

The package never reads cookies, URLs, or storage. Each host injects its runtime through `initPostUiI18n({ getLocale, setLocale })` (`packages/post-ui/src/i18n.ts`), exported as `@feeblo/post-ui/i18n`:

- Dashboard: `apps/web/src/dashboard/main.tsx`
- Public board island: `apps/web/src/public-board/public-board-island.tsx`

Both use `apps/web`'s cookie strategy (`["cookie","baseLocale"]`) as the single source of truth. The same wrapper also initializes `@feeblo/public-feature-board`; see `public-feature-board.md`.

## Adding a message

1. Generate a flat random key with `@inlang/sdk`'s `humanId()` (three words).
2. Add English to the root `messages/en.json` and a translation for every other locale (`messages/{de,zh,es,fr,pt,ru,ar}.json`; German is du-form, brand names stay hardcoded).
3. Call `m.<key>()`. Defaults in function parameters are evaluated per call, so `placeholder = m.<key>()` is safe; module-level default objects are not — use `prop ?? m.<key>()` in render instead.
4. Recompile: `pnpm --filter @feeblo/post-ui build:paraglide` (or run the package `dev` watcher).

Zod messages are dynamic through `{ error: () => m.<key>() }` (Zod v4).

## Tooling

- `build:paraglide` / `dev` (watch) / `machine-translate`.
- Turbo `check-types` and `test` depend on `build:paraglide`, so generated types exist before `tsc` and the Vitest browser tests.
- Browser tests live in `src/**/*.browser.test.tsx` and render with the `baseLocale` fallback (English) unless a test calls `initPostUiI18n`.
