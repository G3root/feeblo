# Public feature board i18n

The public board (`apps/public-feature-board`) is a React SPA rendered inside Astro as a `client:only` island (`apps/web/src/pages/s/[...subDomain].astro`).

## Pattern

[Paraglide monorepo Pattern 1](https://paraglidejs.com/monorepo): one shared catalog at the repo root, compiled per package with its own strategy (see `docs/i18n/README.md`).

- Shared catalog: `project.inlang/` + `messages/{en,de,zh,es,fr,pt,ru,ar}.json` at the repo root.
- The board compiles from the shared project with the `baseLocale` fallback strategy: `--project ../../project.inlang` → git-ignored `apps/public-feature-board/src/paraglide/`.
- The host (`apps/web`) keeps the single locale strategy (`["cookie","baseLocale"]`) and injects its runtime once through `initPublicBoardI18n({ getLocale, setLocale })` in `apps/web/src/public-board/public-board-island.tsx`. The board never reads cookies, URLs, or storage itself.

## Adding a message

1. Generate a flat random key with `@inlang/sdk`'s `humanId()` (slice to three words to match the existing catalog). Never rename an existing key.
2. Add the English copy to the root `messages/en.json` and a translation for every other locale (`messages/{de,zh,es,fr,pt,ru,ar}.json`; German is du-form, brand names stay hardcoded).
3. Call `m.<key>()` in the component. Import `m` relatively: `../paraglide/messages.js` (depth depends on the file).
4. The `dev` watcher recompiles; otherwise run `pnpm --filter @feeblo/public-feature-board build:paraglide`.

Plurals are not supported by the message-format plugin: add one message per variant and pick in code (`count === 1 ? m.one({ count }) : m.other({ count })`).

## Tooling

- `pnpm --filter @feeblo/public-feature-board build:paraglide` — one-shot compile with `.d.ts` declarations.
- `pnpm --filter @feeblo/public-feature-board dev` — watch mode.
- `pnpm dev:web` — runs the Astro dev server and the board's watcher together.
- Turbo wires `check-types` to `build:paraglide` (with `outputs: ["src/paraglide/**"]`) so generated types exist before `tsc` and `astro check`.
