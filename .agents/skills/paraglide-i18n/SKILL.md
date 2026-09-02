---
name: paraglide-i18n
description: Use when adding, changing, or extracting user-facing strings in apps/web, translating copy (en/de), or anything locale/i18n related. Covers the random message-key convention, m.* usage, and the compile/import gotchas.
---

# Paraglide i18n (apps/web)

The i18n stack is **already fully wired up**. Never re-create it, never add another i18n library.

## What exists (do not rebuild)

| Piece | Where |
|---|---|
| Inlang project: `baseLocale: en`, `locales: ["en", "de"]` | `apps/web/project.inlang/settings.json` |
| Translation files | `apps/web/messages/en.json`, `apps/web/messages/de.json` |
| Paraglide JS 2 Vite plugin, strategy `["cookie", "baseLocale"]`, `emitTsDeclarations: true` | `apps/web/astro.config.mjs` |
| Locale middleware (`paraglideMiddleware`, first in sequence) | `apps/web/src/middleware.ts` → `localeMiddleware` |
| `<html lang dir>` already locale-aware | `apps/web/src/layouts/Layout.astro` |
| Generated runtime (gitignored — never hand-edit) | `apps/web/src/paraglide/` |

## Key convention: random human-readable keys (REQUIRED)

Follows [paraglidejs.com/message-keys](https://paraglidejs.com/message-keys). A key is a **stable identity, not documentation** — treat it like a database ID. The message content, its usage, and tooling provide the context, never the key name.

Every message key is **three random English words, lowercase, underscore-separated, and flat** — e.g. `penguin_purple_shoe`, `amber_spruce_yarrow`.

- Keys are **random**: generate them, do not derive them from the text. Semantic keys (`sign_in_title`) are forbidden — they encode placement/copy, which invites renaming when a button changes label or a component moves, and a rename orphans translation history, comments, and QA context attached to the key.
- **Flat keys only — no dots, no nesting.** Nested catalogs force bracket access `m["nav.home"]()` and lose go-to-definition/auto-import. If you encounter legacy dot-keys, leave them as they are.
- All three words must be distinct **across recently added keys** (avoid `dawn` twice in one batch).
- **Never share a key across unrelated contexts — even when the text is identical today.** Two buttons that both say "OK" evolve independently tomorrow; sharing a key means changing one changes both. Each independently evolving message gets its own key.
- Copy may change freely under a key without renaming it — that is the whole point.
- **Never rename an existing key** to make it random or restyle it. Stability beats convention; only change IDs in a deliberate migration that updates every locale, call site, and translation tool together.

Generate a batch (keep words distinct across the batch):

```bash
node -e '
const words = ["amber","basil","cedar","ember","fjord","gale","harbor","iris","jade","kite","lunar","maple","nettle","opal","pine","quartz","river","sage","tide","umbra","velvet","willow","yarrow","zephyr","cobalt","crimson","eager","fable","gentle","hollow","ivory","jolly","kindle","mellow","north","orbit","plume","quiet","rustic","silent","timber","vivid","wander","yonder","zenith","clover","dune","fern","glade","heath","kelp","lark","moss","noble","otter","pearl","quill","penguin","purple","shoe","raven","spruce","tulip"];
const keys = []; const used = new Set();
while (keys.length < 6) {
  const pick = [...words].sort(() => Math.random() - 0.5).slice(0,3);
  if (pick.some(w => used.has(w))) continue;
  pick.forEach(w => used.add(w)); keys.push(pick.join("_"));
}
console.log(keys.join("\n"));'
```

## Finding a message by its copy

Random keys hide the text by design, so lookup and review are a two-step search:

1. Search `apps/web/messages/en.json` for the visible copy → note the key.
2. Search the codebase for that key.

Keep a tiny scratch mapping (key → string) in the PR description so reviewers can follow.

## Dynamic keys

Never build key strings at runtime. Map domain values to message functions explicitly:

```ts
const planLabels = {
  free: m.quiet_violet_whale,
  pro: m.gentle_silver_owl,
} as const;
```

## Workflow for any user-facing string

1. Add the key + English text to `apps/web/messages/en.json` (keep `$schema`; alphabetical order is nice).
2. Add the German translation to `apps/web/messages/de.json` in the same commit. Use **du-form** German (established tone: "Du hast noch kein Konto?").
3. Use it in code:

   ```ts
   import { m } from "@/paraglide/messages"; // ⚠️ @/ NOT ~/ — see gotchas

   <h1>{m.jolly_north_otter()}</h1>
   <p>{m.hollow_umbra_lark({ username: user.name })}</p>
   ```

4. If the dev server is not running, compile:
   `cd apps/web && pnpm build:paraglide`
5. Strings with params: `{username}` in the JSON, `{ username: "…" }` at the call site. Plurals/selectors use message-format `match` syntax.
6. For JSX sentences containing a link (e.g. "Don't have an account? **Sign up**"), split into adjacent messages (lead-in text + link label) rather than embedding markup in translations.

## Gotchas

- **Import alias is `@/paraglide/*`** — tsconfig maps `~/*` to `src/dashboard/*`, so `~/paraglide/messages` silently fails to resolve (error `ts(2307)` in `astro check`).
- `pnpm build:paraglide` (the CLI) does **not** emit `.d.ts`. For typechecking outside dev/build run:
  `npx paraglide-js compile --project ./project.inlang --outdir ./src/paraglide --emit-ts-declarations`
- Never import from or edit `src/paraglide/**` contents directly — it is generated and gitignored.
- `m.*` entries are **functions** — call them. Forgetting `()` renders nothing.
- `localeMiddleware` must stay first in the middleware `sequence`, or server-rendered islands lose locale context.

## Locale switching

Cookie strategy: the locale lives in the `PARAGLIDE_LOCALE` cookie. A switcher endpoint sets the cookie (validated against `locales` exported from `@/paraglide/runtime`) and redirects. Reference implementation to build on: `apps/web/src/pages/api/locale.ts`.

## Adding a locale

1. Add the code to `locales` in `apps/web/project.inlang/settings.json`.
2. Create `apps/web/messages/<locale>.json` with all keys from `en.json`.
3. Recompile. Missing messages fall back to `en` at runtime.

## Machine translation

`cd apps/web && pnpm machine-translate` fills missing translations (needs a provider/API key — check `npx inlang machine translate --help`). Treat output as a draft to review, never commit unreviewed.

## Out of scope for `m.*` (for now)

Server-generated content (transactional emails, Effect RPC error messages) and user-generated content are not covered by this skill — do not force them through UI messages.
