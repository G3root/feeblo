# ADR 0029: The review rules are vendored, and eleven wait on a migration

## Decision

`tools/oxlint/anti-slop/` is a vendored copy of [k-mistele/anti-slop](https://github.com/k-mistele/anti-slop) at `b7c1619` (`oxlint-plugin-anti-slop@0.1.2`), and `oxlint.config.ts` registers all three of its plugins: the generic rules (21), `anti-slop-effect` (14) and `anti-slop-martinfowler` (8, of which 7 are enabled). Every generic and Effect rule is `error`. The smell bundle is `warn`. Eleven rules are `off`, each with the count it reported and the migration that retires it written beside its entry in `oxlint.config.ts` and summarised below.

The paid halves are not installed: the Jev questions and the diff rules each make a model request per file and need a credential, so their directories, their plugins and the plugin's own rule tests are dropped from the copy. `tools/oxlint/anti-slop/UPSTREAM.md` records the revision, that deviation, and the procedure for updating the copy. The installer that produced it is vendored at `.agents/skills/install-anti-slop/`, and the review policy the Effect rules encode is at `.agents/skills/effect-program-design/`.

The copy is this repository's code. A rule that is wrong for this tree is read, changed or turned off here — not worked around at the call site — and an upstream update is merged into it rather than copied over it.

### What the rule set changed

At adoption it reported about 12,250 findings. Everything except the eleven exceptions was fixed:

- `require-readable-spacing` (10,623) — the rule's own fixer, applied once across the tree. It inserts blank lines between a declaration and the statement that uses it; `oxfmt` is a no-op on the result and a second pass reports nothing.
- `require-cause-when-narrowing` (100) — a `mapError`/`catchAll`/`catchCause`/`orElse` handler that takes no parameter and constructs a new error discards the failure that caused the mapping. Seventeen error classes gained `cause: Schema.optionalKey(Schema.Defect())`, the spelling already used elsewhere in the tree, and 84 handlers pass it. The 16 provider and transport mappings keep dropping it with an inline reason: the cause can carry the endpoint URL, request metadata or a SQL statement, and the integration failure algebra keeps those out of persisted and logged failures (`WebhookTransportError`).
- `max-ternary-depth` 12 and `prefer-effect-match` 15 — a ternary chain over one value becomes a named decision: an early-return helper, a `Record` keyed by the discriminant, a `switch`, or one `&&` per JSX branch.
- `no-array-filter-map` 9 — `flatMap`, except where a side effect in the filter had to keep running in order.
- `prefer-yield-service` 3 and `prefer-tagged-error-handling` 5 — documented exceptions. The MCP toolkit and the code-mode sandbox store a handler and invoke it later, from a foreign fiber, so it cannot inherit the environment that built it (ADR 0007); `withRemapDbErrors` filters an arbitrary `E`, and `catchTags` type-checks only when each tag is a member of the error type.

### The eleven exceptions, in five families

- **Plain tagged structs** (488 findings) — `no-manual-tagged-construction` 298, `no-manual-tag-comparison` 142, `no-manual-tagged-type` 48. A domain result is a plain struct — `{ _tag: "Written", intent }` — declared with `Schema.TaggedStruct`/`Schema.Union` and returned by value; there is no class to construct, `switch (x._tag)` is the exhaustive read, and 171 of the 298 are test assertions that have to spell the shape out.
- **`exactOptionalPropertyTypes`** (381) — `no-conditional-spread`. With the option on, a property is either absent or present with a value, so `{ x?: T }` cannot be built by assigning `undefined`: `...(cond && { x })` is how the type is constructed, and the rule's replacement is mutation or a builder at 381 sites.
- **Layer ownership** (75) — `require-service-make-layer` 37, `no-service-constructor-imports` 38. Layers are assembled in the composition root (`apps/server/src/app/layers.ts`, ADR 0002) rather than declared as a `static` on each service, and `make*` is this tree's factory prefix for ordinary values as well as layer builders — one of the second rule's findings is `makeId`, a Legid constructor.
- **Capture-and-reprovide surfaces** (55) — `no-reprovide-ambient-service` 42, `no-service-parameters` 13. A surface that is built from the environment and invoked later — an `HttpApiBuilder` handler, an RPC group, a stored MCP tool handler — cannot inherit the request's context, so it captures its collaborators in `make` and its methods declare no requirements of their own (ADR 0007).
- **Conventions already recorded elsewhere** (35) — `no-disabled-type-assertion-rules` 14, `no-ordie-in-service-construction` 13, `no-test-code-in-src` 8. Every disable finding is a targeted `oxlint-disable-next-line` carrying its own reason beside a `SAFETY:` comment, which AGENTS.md allows; every `orDie` finding is a route table whose construction failure is a programming error; and tests are colocated with the module they cover, with four production modules exporting a test layer another package's tests build on.

## Why

The tree already vendored fifteen of these generic rules from an earlier snapshot, with no provenance file and no Effect half. The Effect rules are the reason to take the update: they name decisions this codebase had been making by convention — a tagged error is matched by tag, a mapping keeps the failure it replaced, a service is built by `make` and advertised by one layer, every operation is traced — so an exception becomes a diagnostic instead of a review comment. That is the same argument ADR 0005 makes for moving the Effect diagnostics out of the compiler and into a tool that can act on them.

The exceptions are `off` rather than ratcheted for the reason ADR 0005 gives for `unstable-api-usage`: a thousand warnings about a different design do not get fixed, they train reviewers to skim the report. But where `unstable-api-usage` names a dependency that has no stable alternative, each of these names a migration with a defined end: adopting `Schema.TaggedUnion` for the domain's results, moving the captured-context surfaces onto the `R` channel, moving layer ownership into the service modules, and splitting the colocated tests into a `test/` tree would each retire its family and let those entries become `error`. The counts are recorded so that work can be planned rather than discovered.

Adopting `Schema.TaggedUnion` now is the one migration worth arguing against on its own terms. It would derive each variant's constructor and its `$match` helper, and it would also put `effect/Schema` into the widget, the SDK and `integrations/core`, which ADR 0005 keeps out of those bundles deliberately. It is a data-model decision with a bundle cost, not a lint fix, and it deserves its own ADR rather than riding along with this one.

## Consequences

A PR author's loop gains two steps. `pnpm lint:fix` applies the spacing fixer before the gate sees it, and `pnpm check` runs the rest. The rules that now fail a build are the ones this ADR keeps at `error`: a narrowing that drops its cause, a chained assertion with no `SAFETY:` comment, an `unknown` that leaves a boundary, a `filter().map()` that should be one pass, a chained ternary over one value.

The eleven `off` entries are a ratchet, not a permanent list. Retiring one means doing the migration named beside it and moving the severity to `error` in the same change, exactly as AGENTS.md's rule for Knip's `warn` types works. Nothing in the list may be extended to cover a new finding: an entry names a family of sites and its migration, and a finding outside that family is a defect to fix.

The smell bundle is a standing report. At the time of writing it is 438 warnings — `long-function` 268, `loops` 119, `repeated-switches` 25, `mutable-data` 23, `mysterious-name` 4, `long-parameter-list` 3 — and they surface as check annotations without failing anything. That is the severity upstream ships and the reason it ships it: a smell is a prompt to look at one function, not a verdict. `long-function` and `loops` account for 387 of them, and refactoring 387 functions to clear a warning is not a lint change. If the annotations become noise, ADR 0005's argument applies and the bundle moves to `off`; that is a decision to take deliberately, with a date and a reason, not a cleanup.

The spacing pass is the one change in this set with a cost outside the repository. It touches 1,047 files, so a branch that was open when it merged can conflict mechanically — six of the eight open at the time did — and the conflicts are almost all the inserted blank lines. The resolution is not line-by-line: take the branch's own code for the conflicted file and run `pnpm lint:fix`, because the rule is a fixer and it will regenerate exactly the spacing that branch's code needs.

## References

- `oxlint.config.ts` — the enabled rules, the eleven exceptions with their counts, and the reason beside each.
- `tools/oxlint/anti-slop/UPSTREAM.md` — the vendored revision, what was not copied, and how to update it.
- `tools/oxlint/anti-slop/effect/` — the fourteen Effect rules this ADR's names refer to.
- `.agents/skills/install-anti-slop/` — the installer, kept so the copy can be updated with its own procedure.
- `.agents/skills/effect-program-design/` — the Effect review policy the rules and the (uninstalled) Jev questions encode.
- `docs/adr/0005` — the gate, the Effect diagnostics, and the ratchet order these entries join.
- `docs/adr/0007` — the Public API's shared root and its captured context.
- `docs/adr/0002` — the composition root that supplies provider layers.
