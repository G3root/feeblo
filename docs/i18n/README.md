# i18n

Paraglide JS with a single shared catalog at the repo root, compiled per package.

## Layout

```
project.inlang/settings.json   # baseLocale en, locales en+de+zh+es+fr+pt+ru+ar
messages/en.json               # all messages, shared by every package
messages/de.json
messages/zh.json
messages/es.json
messages/fr.json
messages/pt.json
messages/ru.json
messages/ar.json
apps/web/src/paraglide/        # generated, git-ignored
apps/public-feature-board/src/paraglide/
packages/post-ui/src/paraglide/
```

This is [Paraglide monorepo Pattern 1](https://paraglidejs.com/monorepo): one `project.inlang`, each consuming package compiles it into its own `src/paraglide/` with the strategy it needs.

## Strategies

- `apps/web` (host): default strategy, the single source of truth for locale detection (`["cookie","baseLocale"]`).
- `apps/public-feature-board` and `packages/post-ui`: `--strategy baseLocale`. They never read cookies, URLs, or storage; the host injects its runtime through `initPublicBoardI18n` / `initPostUiI18n` (`overwriteGetLocale` / `overwriteSetLocale`).

## Commands

```bash
# from a package
pnpm --filter @feeblo/post-ui build:paraglide
pnpm --filter @feeblo/post-ui dev              # watch
pnpm --filter @feeblo/post-ui machine-translate

# all packages at once (turbo caches src/paraglide/** and depends on the root catalog)
pnpm build
```

Every `build:paraglide` script points at `../../project.inlang`; Turbo lists the root `project.inlang/**` and `messages/**` as inputs, so a catalog change invalidates every package's cached output.

## Adding a message

1. Generate a flat random key with `@inlang/sdk`'s `humanId()` (three words). Never rename an existing key.
2. Add the English copy to `messages/en.json` plus a translation for every other locale (`messages/{de,zh,es,fr,pt,ru,ar}.json`; German is du-form, brand names stay hardcoded).
3. Call `m.<key>()` in the component; import `m` from the package's local `src/paraglide/messages.js`.
4. Recompile the owning package (`build:paraglide`) or run its `dev` watcher.

Plurals are not supported by the message-format plugin: add one message per variant and pick in code (`count === 1 ? m.one({ count }) : m.other({ count })`).
