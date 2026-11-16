# anti-slop (vendored)

This directory is a copy of the [k-mistele/anti-slop](https://github.com/k-mistele/anti-slop)
Oxlint plugin, which is a fork of [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop).

- Source: `https://github.com/k-mistele/anti-slop`
- Revision: `b7c1619b4d51b4815e89ba3700a975a6ec54b8c3` (2026-02, `main`), published as
  `oxlint-plugin-anti-slop@0.1.2`
- Copied from the repository's `src/` directory to `tools/oxlint/anti-slop/`
- Installed by the `install-anti-slop` agent skill, which is vendored at
  `.agents/skills/install-anti-slop/`

## What is here

| Path | Contents |
| --- | --- |
| `index.ts` | The generic `anti-slop` plugin, one rule per file under `rules/`. |
| `effect/` | The opt-in `anti-slop-effect` plugin: Effect service, Layer, tagged-error and tracing rules. |
| `martinfowler/` | The opt-in `anti-slop-martinfowler` plugin: Martin Fowler's code smells from *Refactoring*, run at `warn`. |
| `shared/` | ESTree helpers the rule files share. |
| `vendor/eslint-stylistic/` | `padding-line` code taken from ESLint Stylistic (MIT), which `require-readable-spacing` is built on. `LICENSE` and `UPSTREAM.md` travel with it. |

`oxlint.config.ts` registers all three plugins and sets each rule's severity. `oxfmt.config.ts`
and `oxlint.config.ts` both ignore this directory, so the copy keeps upstream's formatting and is
never linted as application source.

## Intentional deviations from upstream

- **Not vendored:** `src/jev/`, `src/diff-rules/`, `src/martinfowler/jev-*.ts`, and every
  `*.test.ts`. The Jev questions and the diff rules each make a paid model request per file and
  need `TYPESAFE_API_KEY` (or an equivalent) plus the Vercel AI SDK, so they are opt-in per the
  installer's instructions and are not installed here. The upstream rule tests run against
  `test-utils` from the plugin's own repository and are not part of this package's test run.
- Everything else is byte-for-byte upstream.

## Updating

Follow `.agents/skills/install-anti-slop/references/update.md`: diff the new upstream `src/`
against this copy, merge into it rather than replacing it, keep local deviations listed above,
and record the new revision here. The rule severities and the reasons for any `off` entries live
in `oxlint.config.ts`, not in this directory.
