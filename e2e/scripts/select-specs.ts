import { execFile } from "node:child_process";
import { appendFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const e2eDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const repositoryRoot = path.resolve(e2eDirectory, "..");
const testsDirectory = path.join(e2eDirectory, "tests");

/** The fenced block that tells CI which specs a pull request exercises. */
const blockPattern = /```e2e[^\n]*\n([\s\S]*?)```/g;

class SelectionFailed extends Error {}

/**
 * Chooses the e2e specs a run should execute.
 *
 * A pull request states its own coverage in one fenced `e2e` block in the
 * description: spec file names, `none` when no scenario exercises the change,
 * or `all: <reason>` when every scenario does. Spec files the pull request
 * changes are always included, so a new or edited test cannot be skipped.
 * Pushes to main have no pull request body and run everything.
 *
 * The selection is deliberately explicit: a missing block fails the run rather
 * than falling back to the full suite, because "ran everything by accident"
 * and "chose to run everything" should not look the same in review.
 */
const main = async (): Promise<void> => {
  const body = process.env.PR_BODY ?? "";
  const baseSha = process.env.BASE_SHA ?? "";

  const specFiles = new Set(
    (await readdir(testsDirectory)).filter((name) => name.endsWith(".spec.ts"))
  );

  if (body.trim() === "") {
    // A push to main, or a manual run: there is no block to read.
    await report({
      run: true,
      specs: [],
      reason: "No pull request description; running every scenario.",
    });
    return;
  }

  const directives = parseBlock(body);
  const changedSpecs = await changedSpecFiles(baseSha);
  const selected = select(directives, specFiles, changedSpecs);
  await report(selected);
};

const parseBlock = (body: string): string[] => {
  const blocks = [...body.matchAll(blockPattern)];
  const block = blocks[0];
  if (block === undefined) {
    throw new SelectionFailed(
      "The pull request description has no ```e2e block. Add one listing the spec files this change exercises, or write `none`, or `all: <reason>`."
    );
  }
  if (blocks.length > 1) {
    throw new SelectionFailed(
      "The pull request description has more than one ```e2e block. Keep exactly one."
    );
  }
  const content = block[1] ?? "";
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

/** The spec files the pull request itself added or changed, repo-relative. */
const changedSpecFiles = async (baseSha: string): Promise<string[]> => {
  if (baseSha === "") {
    return [];
  }
  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--name-only", `${baseSha}...HEAD`],
    { cwd: repositoryRoot }
  ).catch(() => {
    throw new SelectionFailed(
      `Could not diff against ${baseSha}; the checkout needs full history to select specs.`
    );
  });
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) => line.startsWith("e2e/tests/") && line.endsWith(".spec.ts")
    )
    .map((line) => line.replace("e2e/tests/", "tests/"));
};

type Selection = {
  readonly run: boolean;
  readonly specs: readonly string[];
  readonly reason: string;
};

const select = (
  directives: string[],
  specFiles: ReadonlySet<string>,
  changedSpecs: readonly string[]
): Selection => {
  if (directives.length === 0) {
    throw new SelectionFailed(
      "The e2e block is empty. Write spec file names, `none`, or `all: <reason>`."
    );
  }
  const first = directives[0] ?? "";
  const changed = [...new Set(changedSpecs)].sort();

  if (isDirective(first, "none")) {
    if (directives.length > 1) {
      throw new SelectionFailed("`none` must be the only line in the block.");
    }
    if (changed.length > 0) {
      return {
        run: true,
        specs: changed,
        reason:
          "The block says none, but this pull request changes spec files, which always run.",
      };
    }
    return {
      run: false,
      specs: [],
      reason:
        "The block says none; the app is still built but no scenario runs.",
    };
  }

  if (isDirective(first, "all")) {
    const reason = first.slice("all".length).replace(/^\s*:?\s*/, "");
    if (reason === "") {
      throw new SelectionFailed(
        "`all` needs a reason, for example `all: changes the e2e harness`."
      );
    }
    if (directives.length > 1) {
      throw new SelectionFailed(
        "`all` must be the only line in the block; list specs instead to run a subset."
      );
    }
    return {
      run: true,
      specs: [],
      reason: `The block asks for every scenario: ${reason}`,
    };
  }

  const named = directives.map((directive) => {
    const relative = `tests/${directive
      .replace(/^\.\//, "")
      .replace(/^e2e\/tests\//, "")
      .replace(/^tests\//, "")}`;
    const file = path.basename(relative);
    if (!specFiles.has(file)) {
      throw new SelectionFailed(
        `Unknown spec "${directive}". Valid specs: ${[...specFiles].sort().join(", ")}`
      );
    }
    return relative;
  });

  const specs = [...new Set([...named, ...changed])].sort();
  const changedNote =
    changed.length > 0 ? `, plus ${changed.length} changed spec file(s)` : "";
  return {
    run: specs.length > 0,
    specs,
    reason: `${named.length} named spec file(s)${changedNote}.`,
  };
};

const isDirective = (line: string, name: string): boolean =>
  line === name || line.startsWith(`${name}:`) || line.startsWith(`${name} `);

/** Writes the GitHub Actions outputs and a human-readable summary. */
const report = async (selection: Selection): Promise<void> => {
  const specs = selection.specs.join(" ");
  await setOutput("run", selection.run ? "true" : "false");
  await setOutput("specs", specs);

  const summary = [
    "## E2E selection",
    "",
    selection.reason,
    "",
    selection.run
      ? specs === ""
        ? "Running every scenario."
        : `Running: ${specs}`
      : "Skipping the Playwright step; the app build still runs.",
    "",
  ].join("\n");

  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile !== undefined && summaryFile !== "") {
    await appendFile(summaryFile, summary);
  }
  console.log(summary);
};

const setOutput = async (name: string, value: string): Promise<void> => {
  const file = process.env.GITHUB_OUTPUT;
  if (file === undefined || file === "") {
    console.log(`${name}=${value}`);
    return;
  }
  await appendFile(file, `${name}=${value}\n`);
};

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`select-specs: ${message}`);
  process.exitCode = 1;
}
