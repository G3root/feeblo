# ADR 0030: The icon picker is a generated sprite over a virtualized grid

## Decision

`packages/ui/src/icon-picker/` is a Tabler (filled) icon picker. Four choices are decisions rather than defaults:

- **The icon set is generated, not imported.** `@tabler/icons` ships 1,054 filled SVGs; the build script renders them into one `<symbol>` sprite and one metadata module. No icon is a React component.
- **The sprite is fetched, and the metadata is code-split.** Both are generated, but they load for different readers: a trigger showing the selected icon needs the sprite, and only an opened picker needs the search metadata. The sprite is fetched by the first `TablerIcon`; the metadata is a dynamic `import()` started by `IconPicker.Root`.
- **The picker's behaviour is a port of [Frimousse](https://github.com/liveblocks/frimousse), not a reimplementation.** The virtualization, the keyboard grid, the sticky category headers and the measurement of the caller's own `Icon` and `CategoryHeader` components are kept as they are. The emoji-specific parts are removed: skin tones, locales, the locale-aware Emojibase resolver, and the emoji font.
- **The store is an `@xstate/store` event map, and `interaction` is its one declared lifecycle.** There is no statechart, because the state the virtualizer needs is not a lifecycle: it is measured DOM geometry (`rowHeight`, `viewportHeight`, `viewportScrollY`) that a machine would only mirror.

The picker is a design-system component exported as `@feeblo/ui/icon-picker`. `IconPickerField` is its popover-backed trigger, and the board, post-status and help-center-topic settings dialogs use it. Each stores a Tabler name in a nullable text column and resolves a null or unknown name to a client default in `@feeblo/web-shared/icons/defaults`: the default lives on the client so the artwork can change without a migration, and a row that predates the picker still renders a mark. Wiring the changelog category's `iconType: "icon"` is still a product change with its own schema work, not part of this one.

### The generated artefacts

`pnpm --filter @feeblo/ui icons:generate` reads `@tabler/icons` and writes, into `packages/ui/src/icon-picker/generated/`:

- `tabler-filled-sprite.svg` — one `<symbol id="tabler-filled-{name}">` per icon, SVGO-optimized with `preset-default` (`multipass`), background path removed, coordinates rounded to two decimals. 396.1 KB raw / 79.4 KB gzip / 60.7 KB brotli, one cacheable asset.
- `tabler-filled-icons.ts` — name, humanized label, category index and curated tags per icon; 154.2 KB raw / 30.4 KB gzip. The `category` is an index into `TABLER_FILLED_CATEGORIES` so each category name is stored once. It is a dynamically imported chunk, not part of the route bundle.
- `tabler-filled-symbol-prefix.ts` — the static `tabler-filled-` symbol prefix, in its own module on purpose: a static import of _anything_ from `tabler-filled-icons.ts` would pull the whole catalogue into the initial chunk and undo the split.
- `LICENSE-tabler-icons.txt` — Tabler's MIT notice, carried beside the derivative work.
- `packages/web-shared/src/icons/generated/tabler-filled-names.ts` — the 1,054 names as a `ReadonlySet`, 18.9 KB raw. The entity-icon defaults validate a stored name against it before rendering, so an unknown name falls back to the entity default instead of an empty tile. The resolver lives in `@feeblo/web-shared`, which cannot import `@feeblo/ui` because the UI package depends on it, so the generator writes this one file into web-shared. It carries no labels, categories or tags; those stay in the lazy catalogue.

The output is committed. `pnpm check` must not need a code generator, and a dependency bump should produce a reviewable diff of the sprite, the metadata and the name set rather than changing at install time. The generated files are excluded from `oxlint` and `oxfmt`: the generator owns their layout, and reformatting them would make every regeneration a whole-file diff.

`@tabler/icons` is pinned exactly in the catalog for the same reason: a range would let an install change what the generated files should contain without changing them.

### Why a sprite

An emoji list is text; an icon list is SVG. Rendering 1,054 `@tabler/icons-react` components would either ship every icon in the route chunk or force the picker's cells to be a fixed list of imports the search cannot address. A sprite keeps the cells to one `<use href="#…">`, the names to the metadata, and the payload to a single asset that is fetched when the picker first renders.

The sprite is fetched as text and inserted into the document, rather than referenced as `<use href="sprite.svg#id">`: Safari does not support external `use` references at all. The container is zero-sized and absolutely positioned rather than `display: none`, because a symbol inside a hidden subtree is not reliably rendered as a shadow tree. The fetch is a module-level singleton, shared by every picker and every trigger icon on the page.

It is also not inlined as `?raw`: that would put the sprite in the route chunk, where it would be parsed on every visit to the page even when the picker never opens.

### Why only the metadata is lazy

The artefacts have different readers. A settings page renders a trigger that shows the selected icon; that trigger needs the sprite, and the resolver needs the name set to reject an unknown stored name. The catalogue is 30.4 KB gzip of labels and tags that only matter once the picker opens. So the metadata is a dynamic `import()` with a literal path, started when `IconPicker.Root` mounts, and the sprite stays an eagerly fetched asset because deferring it would mean a trigger cannot draw its icon.

The two requests run in parallel when the picker opens, and the `Loading` part covers both. Typing before the chunk settles only records the query; the store derives the grid from the search it holds when the catalogue arrives. `IconPicker.preload` starts the chunk from a trigger's `onPointerEnter`/`onFocus`, so a hovered trigger has usually paid for it by the time the click lands.

The static prefix module is the trap this split sets. The first version imported `TABLER_FILLED_SYMBOL_PREFIX` from the generated catalogue, which made the entire 30 KB-gzip module synchronous again with nothing visibly wrong; the browser test now asserts the catalogue is _not_ requested on a page that renders only a trigger, and the production build emits it as its own chunk (`tabler-filled-icons-*.js`, 29.9 KB gzip).

A failed catalogue load is retryable (the cached promise is cleared) and renders the empty state rather than a spinner that never resolves; the error is logged where it happened.

### Why the Frimousse core

The picker's hard parts are not search. They are the virtualized grid whose row and header heights come from components the caller wrote, the sticky headers positioned over a virtual window without a fixed row size, the arrow-key wrapping that has to work when the last row is partial, and the ARIA grid semantics. Those are exactly the parts that are easy to write and hard to get right, and Frimousse has them behind 95%+ test coverage. The port keeps the algorithm and changes the vocabulary.

The store is the one structural deviation. Frimousse's store is a tiny custom store with a `set(partial)` API because its data arrives asynchronously and it holds DOM refs. Here there is one fetch to await — the catalogue chunk — and the row derivation is synchronous once it settles, so the store needs a single `catalogueSettled` transition rather than Frimousse's resolver, locale and cache machinery. The DOM refs stay in React context. `@xstate/store` was already the repository's event-store pattern (`packages/web-shared/src/lib/xstate.tsx`, `packages/post-ui`), so the port uses it rather than adding a second store implementation.

The reset event carries a `reason` (`blur`, `search-focus`, `pointer-leave`) because it is sent from three places and a store inspection should say which one. There is no mount reset: the initial state is already `none`.

## Consequences

- **Bumping `@tabler/icons` is a regeneration.** The catalog pin is exact; the PR contains the sprite diff and the metadata diff, which is what makes an icon that was renamed or removed visible. The generator is deterministic (no timestamps, fixed ordering) so an unchanged dependency produces no diff.
- **The picker's first open fetches ~396 KB of sprite (79.4 KB gzip / 60.7 KB brotli) and a ~30 KB gzip catalogue chunk, in parallel.** The `Loading` part covers both; afterwards the browser cache serves them. Splitting the sprite per category is the lever if that becomes a problem, and it is unnecessary until a picker is on a first-paint path. A page that only renders a trigger icon downloads the sprite and never the catalogue.
- **The sprite's coordinates are rounded to two decimals.** That is 0.01 of a 24-unit viewBox, sub-pixel at every size the picker renders, and it cuts the raw sprite from 472 KB to 396 KB (101 KB to 79 KB gzip). A precision bump is a regeneration with a visible diff.
- **A custom `Icon` or `CategoryHeader` is measured, not assumed.** The defaults are 32 px buttons and a 28 px header, but the list measures the caller's components, so a larger cell changes every row. The measurement is why the `List` renders an invisible sizer even when the result set is empty.
- **The default grid is 9 columns and the picker is unstyled by default except for its defaults.** `IconPicker.Root` composes; `IconPicker.Content` is the drop-in composition (search, viewport, loading, empty, list) sized for a popover. Neither owns a popover: the consumer brings coss's `Popover`/`Dialog`, which is the same separation Frimousse documents.
- **Selection is not owned.** The picker reports `onIconSelect({ name, label })` and renders the `value` it is given. Closing the popover on select, storing the name, and resolving an unknown stored name are the consumer's decisions.
- **Four dependencies were added to the catalog:** `@tabler/icons` (generator only), `svgo` (generator only), and `@xstate/store` / `@xstate/store-react` (the picker's store). `apps/web` already consumed the two xstate packages; they now reference the catalog rather than their own ranges, so there is one version of each in the workspace.
