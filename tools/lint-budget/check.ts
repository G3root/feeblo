#!/usr/bin/env node
/**
 * The lint gate: runs Oxlint once, fails on its errors, and holds its warnings
 * to a per-rule budget.
 *
 * `turbo run check` runs this instead of a bare `oxlint`, because a bare
 * `oxlint` fails only on *errors*. The thousand-odd warnings that `docs/adr/0005`
 * describes as the ratchet are invisible to it, so a pull request can add fifty
 * `global-date-in-effect` findings and CI stays green. Here they are counted per
 * rule and compared against `budget.json`.
 *
 * Only the deltas are printed: the rules that went over, the rules that came
 * down, and the individual findings behind an overage. A clean run prints one
 * line. `pnpm exec oxlint .` still prints every finding in Oxlint's own format.
 *
 * A rule that improves is reported, not failed — lowering the number is the
 * point, and requiring the baseline in the same commit would fail every cleanup
 * pull request. Run with `--update` to record the new numbers.
 *
 * Usage:
 *   node tools/lint-budget/check.ts            # fail on any increase
 *   node tools/lint-budget/check.ts --verbose  # also print every warning
 *   node tools/lint-budget/check.ts --update   # rewrite budget.json
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface DiagnosticLabel {
  readonly span: { readonly line: number; readonly column: number };
}

interface Diagnostic {
  readonly code: string;
  readonly filename: string;
  readonly message: string;
  readonly severity: string;
  readonly labels?: readonly DiagnosticLabel[];
}

interface OxlintReport {
  readonly diagnostics: readonly Diagnostic[];
}

interface OxlintRun {
  readonly report: OxlintReport;
  readonly failed: boolean;
}

const here = dirname(fileURLToPath(import.meta.url));
const budgetPath = join(here, "budget.json");

const formatRule = (code: string): string => {
  const match = /^([a-z-]+)\((.+)\)$/.exec(code);
  return match ? `${match[1]}/${match[2]}` : code;
};

const formatFinding = (diagnostic: Diagnostic): string => {
  const span = diagnostic.labels?.[0]?.span;
  const at = span ? `:${span.line}:${span.column}` : "";
  return `  ${diagnostic.filename}${at}\n    ${formatRule(diagnostic.code)}: ${diagnostic.message}`;
};

const countWarningsByRule = (
  diagnostics: readonly Diagnostic[]
): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity !== "warning") {
      continue;
    }
    counts.set(diagnostic.code, (counts.get(diagnostic.code) ?? 0) + 1);
  }
  return counts;
};

/**
 * Runs Oxlint and returns its report plus whether it exited non-zero.
 *
 * `spawnSync` rather than `execFileSync`: Oxlint exits non-zero when it reports
 * an error, and a thrown `execFileSync` would print the entire report — half a
 * megabyte of diagnostics — inside the stack trace.
 */
const runOxlint = (): OxlintRun => {
  const result = spawnSync("pnpm", ["exec", "oxlint", "--format=json", "."], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }

  // SAFETY: `--format=json` is Oxlint's own machine-readable report, and this
  // script reads only the fields the interface above declares. A malformed
  // report fails the parse rather than producing a wrong count.
  const report = JSON.parse(result.stdout) as OxlintReport;

  return { failed: result.status !== 0, report };
};

type BudgetResult =
  | { readonly ok: true; readonly budget: Map<string, number> }
  | { readonly ok: false; readonly reason: string };

const budgetLabel = "tools/lint-budget/budget.json";

/**
 * A recorded count is a non-negative integer, and nothing else.
 *
 * `JSON.parse` will happily hand back `{"some(rule)": "oops"}`. Comparing a
 * count against that string yields `NaN`, which is neither greater nor less than
 * zero, so the rule would match neither the over-budget nor the improved branch
 * and the gate would report success for it. A malformed budget has to fail.
 *
 * The check is inline rather than a `(value: unknown) => value is number` guard:
 * `anti-slop/no-unknown-parameters` bans the annotation, and its advice — parse
 * at the I/O boundary — would mean pulling `effect/Schema` into a tool that has
 * no declared dependency on it. `Object.entries` types each value as `any`,
 * which is what gets validated here.
 */
const readBudget = (): BudgetResult => {
  let contents: string;
  try {
    contents = readFileSync(budgetPath, "utf8");
  } catch {
    return { ok: false, reason: "the file is missing" };
  }

  const budget = new Map<string, number>();
  try {
    const parsed = JSON.parse(contents);
    for (const [rule, value] of Object.entries(parsed)) {
      if (!Number.isInteger(value) || value < 0) {
        return {
          ok: false,
          reason: `the count for ${rule} is not a non-negative integer`,
        };
      }
      budget.set(rule, value);
    }
  } catch {
    return { ok: false, reason: "it is not an object of rule names to counts" };
  }

  return budget.size > 0
    ? { ok: true, budget }
    : { ok: false, reason: "it holds no rules" };
};

const writeBudget = (counts: Map<string, number>): void => {
  const sorted = Object.fromEntries(
    [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
  );
  writeFileSync(budgetPath, `${JSON.stringify(sorted, null, 2)}\n`);
};

const main = (): number => {
  const { report, failed } = runOxlint();

  const errors = report.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error"
  );
  if (failed || errors.length > 0) {
    console.error(`lint-budget: Oxlint reported ${errors.length} error(s):`);
    console.error(errors.map(formatFinding).join("\n"));
    return 1;
  }

  const counts = countWarningsByRule(report.diagnostics);
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);

  if (process.argv.includes("--update")) {
    writeBudget(counts);
    console.log(
      `lint-budget: recorded ${counts.size} rules, ${total} warnings`
    );
    return 0;
  }

  const budgetResult = readBudget();
  if (!budgetResult.ok) {
    console.error(
      `lint-budget: ${budgetLabel} could not be used — ${budgetResult.reason}.`
    );
    console.error(
      "Regenerate it with `node tools/lint-budget/check.ts --update`."
    );
    return 1;
  }
  const budget = budgetResult.budget;
  const over: Diagnostic[] = [];
  const overRules: string[] = [];
  const under: string[] = [];

  for (const rule of new Set([...counts.keys(), ...budget.keys()])) {
    const actual = counts.get(rule) ?? 0;
    const allowed = budget.get(rule) ?? 0;
    const delta = actual - allowed;
    if (delta > 0) {
      overRules.push(
        `  ${formatRule(rule).padEnd(48)} ${String(actual).padStart(4)} (budget ${allowed}, +${delta})`
      );
      over.push(
        ...report.diagnostics.filter(
          (diagnostic) =>
            diagnostic.severity === "warning" && diagnostic.code === rule
        )
      );
    } else if (delta < 0) {
      under.push(
        `  ${formatRule(rule).padEnd(48)} ${String(actual).padStart(4)} (budget ${allowed}, ${delta})`
      );
    }
  }

  if (under.length > 0) {
    console.log(
      `lint-budget: ${under.length} rule(s) improved. Run \`node tools/lint-budget/check.ts --update\` to tighten the budget.`
    );
    console.log(under.sort().join("\n"));
  }

  if (process.argv.includes("--verbose")) {
    console.log(
      report.diagnostics
        .filter((diagnostic) => diagnostic.severity === "warning")
        .map(formatFinding)
        .join("\n")
    );
  }

  if (overRules.length === 0) {
    console.log(`lint-budget: ${total} warnings, all within budget.`);
    return 0;
  }

  console.error(
    `lint-budget: ${overRules.length} rule(s) exceed the recorded budget:`
  );
  console.error(overRules.sort().join("\n"));
  console.error("\nThe findings behind the overage:");
  console.error(over.map(formatFinding).join("\n"));
  console.error(
    "\nFix the findings, or lower the offending rule's severity in oxlint.config.ts with a written reason."
  );
  return 1;
};

process.exit(main());
