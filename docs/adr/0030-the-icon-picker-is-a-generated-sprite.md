# ADR 0030: The icon picker is a generated sprite over a virtualized grid

## Decision

`packages/ui/src/icon-picker/` is a Tabler (filled) icon picker. Three choices are decisions rather than defaults:

- **The icon set is generated, not imported.** `@tabler/icons` ships 1,054 filled SVGs; the build script renders them into one `<symbol>` sprite and one metadata module. The picker imports the metadata and fetches the sprite. No icon is a React component.
- **The picker's behaviour is a port of [Frimousse](https://github.com/liveblocks/frimousse), not a reimplementation.** The virtualization, the keyboard grid, the sticky category headers and the measurement of the caller's own `Icon` and `CategoryHeader` components are kept as they are. The emoji-specific parts are removed: skin tones, locales, the async Emojibase resolver, and the emoji font.
- **The store is an `@xstate/store` event map, and `interaction` is its one declared lifecycle.** There is no statechart, because the state the virtualizer needs is not a lifecycle: it is measured DOM geometry (`rowHeight`, `viewportHeight`, `viewportScrollY`) that a machine would only mirror.

The picker is a design-system component exported as `@feeblo/ui/icon-picker`; no product surface selects an icon yet. Wiring it into the changelog category's `iconType: "icon"` is a product change with its own schema work, not part of this one.

### The generated artefacts

`pnpm --filter @feeblo/ui icons:generate` reads `@tabler/icons` and writes, into `packages/ui/src/icon-picker/generated/`:

- `tabler-filled-sprite.svg` — one `<symbol id="tabler-filled-{name}">` per icon, SVGO-optimized with `preset-default` (`multipass`), background path removed. 471.6 KB raw, one cacheable asset.
- `tabler-filled-icons.ts` — name, humanized label, category index and curated tags per icon; 154.3 KB. The `category` is an index into `TABLER_FILLED_CATEGORIES` so each category name is stored once.
- `LICENSE-tabler-icons.txt` — Tabler's MIT notice, carried beside the derivative work.

The output is committed. `pnpm check` must not need a code generator, and a dependency bump should produce a reviewable diff of the sprite and the metadata rather than changing at install time. The three files are excluded from `oxlint` and `oxfmt`: the generator owns their layout, and reformatting them would make every regeneration a whole-file diff.

`@tabler/icons` is pinned exactly in the catalog for the same reason: a range would let an install change what the generated files should contain without changing them.

### Why a sprite

An emoji list is text; an icon list is SVG. Rendering 1,054 `@tabler/icons-react` components would either ship every icon in the route chunk or force the picker's cells to be a fixed list of imports the search cannot address. A sprite keeps the cells to one `<use href="#…">`, the names to the metadata, and the payload to a single asset that is fetched when the picker first renders.

The sprite is fetched as text and inserted into the document, rather than referenced as `<use href="sprite.svg#id">`: Safari does not support external `use` references at all. The container is zero-sized and absolutely positioned rather than `display: none`, because a symbol inside a hidden subtree is not reliably rendered as a shadow tree. The fetch is a module-level singleton, shared by every picker and every trigger icon on the page.

It is also not inlined as `?raw`: that would put the sprite in the route chunk, where it would be parsed on every visit to the page even when the picker never opens. The metadata is inline because the search needs it immediately.

### Why the Frimousse core

The picker's hard parts are not search. They are the virtualized grid whose row and header heights come from components the caller wrote, the sticky headers positioned over a virtual window without a fixed row size, the arrow-key wrapping that has to work when the last row is partial, and the ARIA grid semantics. Those are exactly the parts that are easy to write and hard to get right, and Frimousse has them behind 95%+ test coverage. The port keeps the algorithm and changes the vocabulary.

The store is the one structural deviation. Frimousse's store is a tiny custom store with a `set(partial)` API because its data arrives asynchronously and it holds DOM refs. Here the data is synchronous, so the store derives the result set from `columns`/`search` in the same transition, and the DOM refs stay in React context. `@xstate/store` was already the repository's event-store pattern (`packages/web-shared/src/lib/xstate.tsx`, `packages/post-ui`), so the port uses it rather than adding a second store implementation.

The reset event carries a `reason` (`blur`, `search-focus`, `pointer-leave`) because it is sent from three places and a store inspection should say which one. There is no mount reset: the initial state is already `none`.

## Consequences

- **Bumping `@tabler/icons` is a regeneration.** The catalog pin is exact; the PR contains the sprite diff and the metadata diff, which is what makes an icon that was renamed or removed visible. The generator is deterministic (no timestamps, fixed ordering) so an unchanged dependency produces no diff.
- **The picker's first open fetches ~470 KB** (roughly 100 KB compressed). The `Loading` part covers the window; afterwards the browser cache serves it. Splitting the sprite per category is the lever if that becomes a problem, and it is unnecessary until a picker is on a first-paint path.
- **A custom `Icon` or `CategoryHeader` is measured, not assumed.** The defaults are 32 px buttons and a 28 px header, but the list measures the caller's components, so a larger cell changes every row. The measurement is why the `List` renders an invisible sizer even when the result set is empty.
- **The default grid is 9 columns and the picker is unstyled by default except for its defaults.** `IconPicker.Root` composes; `IconPicker.Content` is the drop-in composition (search, viewport, loading, empty, list) sized for a popover. Neither owns a popover: the consumer brings coss's `Popover`/`Dialog`, which is the same separation Frimousse documents.
- **Selection is not owned.** The picker reports `onIconSelect({ name, label })` and renders the `value` it is given. Closing the popover on select, storing the name, and resolving an unknown stored name are the consumer's decisions.
- **Four dependencies were added to the catalog:** `@tabler/icons` (generator only), `svgo` (generator only), and `@xstate/store` / `@xstate/store-react` (the picker's store). `apps/web` already consumed the two xstate packages; they now reference the catalog rather than their own ranges, so there is one version of each in the workspace.
