/**
 * Guards the dependency trains `AGENTS.md` says must move together.
 *
 * It is a plain script rather than a test because it reads the repository's own
 * manifests, not a package's behaviour, and because `pnpm check` runs it on every
 * push: a train that diverges fails the gate instead of surfacing as diagnostics
 * that quietly stopped firing.
 *
 * What it checks:
 *
 * 1. Every `effect` and `@effect/*` spec is `catalog:` or the catalog's exact
 *    `effect` version. `@effect/tsgo` is exempt: it is the language service and
 *    is versioned separately. The workspace `overrides` are checked too, because
 *    `@effect/platform-node-shared` is pinned there rather than in a manifest.
 * 2. The compiler train is declared exactly once. `typescript` lives in the
 *    catalog; `@effect/tsgo`, `oxlint`, `oxlint-tsgolint` and `@oxlint/plugins`
 *    live in the root `package.json`, `oxlint` and `@oxlint/plugins` share a
 *    release, and no package pins any of them to something else.
 * 3. Every `patchedDependencies` selector names a version that is installed. A
 *    selector that names no installed version is a no-op, and the package then
 *    runs unpatched with the install still succeeding.
 *
 * The pairing between `@effect/tsgo` and TypeScript/Oxlint is not checked here:
 * `effect-tsgo patch` (run from `prepare` on every install) refuses a mismatch,
 * so a second, weaker copy of that rule would only add drift.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = import.meta.dirname;

/** The Effect release train. `@effect/tsgo` versions itself. */
const effectPackage = /^@effect\/(?!tsgo$)/;

/** A dependency map: `{ "@effect/sql-pg": "catalog:" }`. */
type Dependencies = Readonly<Record<string, string>>;

/** The `package.json` fields this check reads, and nothing else. */
type ManifestJson = Partial<
  Record<
    | "dependencies"
    | "devDependencies"
    | "optionalDependencies"
    | "peerDependencies"
    | "overrides",
    Dependencies
  >
>;

type Manifest = { readonly file: string; readonly json: ManifestJson };

const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "overrides",
] as const;

/** An exact semver 2.0.0 version, prerelease included. */
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

type Mapping = ReadonlyMap<string, string>;

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const source = (file: string) => readFileSync(join(root, file), "utf8");

/**
 * A flat top-level mapping in `pnpm-workspace.yaml`, such as `catalog:`.
 *
 * The file's shape is ours, so a line this reader cannot parse is an error: a
 * silently skipped entry would turn the check into one that always passes.
 */
const readMapping = (yaml: string, key: string): Mapping => {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => line === `${key}:`);
  if (start === -1)
    fail(`pnpm-workspace.yaml has no top-level \`${key}:\` block.`);

  const entries = new Map<string, string>();
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (!line.startsWith(" ")) break;
    const entry = /^ {2}("?)([^":]+)\1: (.+)$/.exec(line);
    if (entry === null) {
      fail(`Cannot read \`${key}\` entry: ${line}`);
      continue;
    }
    entries.set(entry[2] ?? "", (entry[3] ?? "").trim());
  }
  return entries;
};

const readManifests = (): ReadonlyArray<Manifest> => {
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  return tracked
    .filter((file) => file === "package.json" || file.endsWith("/package.json"))
    .map((file) => ({
      file,
      // SAFETY: package.json is JSON by definition. Only the dependency maps
      // above are read, and a field of any other shape reads as absent.
      json: JSON.parse(source(file)) as ManifestJson,
    }));
};

const dependencies = (
  manifest: Manifest,
  field: (typeof dependencyFields)[number]
) => manifest.json[field] ?? {};

/** A group's failures, headed only when there are any. */
const group = (
  title: string,
  failures: ReadonlyArray<string>
): ReadonlyArray<string> =>
  failures.length === 0 ? [] : ["", `${title}.`, ...failures];

const checkEffectTrain = (
  catalog: Mapping,
  overrides: Mapping,
  manifests: ReadonlyArray<Manifest>
): ReadonlyArray<string> => {
  const pinned = catalog.get("effect");
  if (pinned === undefined)
    return ["pnpm-workspace.yaml catalog has no `effect` entry."];

  const failures: Array<string> = [];
  if (!exactVersion.test(pinned)) {
    failures.push(
      `  catalog.effect is ${pinned}; the train must be an exact version.`
    );
  }
  for (const manifest of manifests) {
    for (const field of dependencyFields) {
      for (const [name, spec] of Object.entries(
        dependencies(manifest, field)
      )) {
        if (name !== "effect" && !effectPackage.test(name)) continue;
        if (spec === "catalog:") continue;
        if (spec !== pinned) {
          failures.push(
            `  ${manifest.file} ${field}.${name} is ${spec}; the Effect train is ${pinned}. Use "catalog:".`
          );
        }
      }
    }
  }
  for (const [name, spec] of overrides) {
    if (name !== "effect" && !effectPackage.test(name)) continue;
    if (spec !== pinned) {
      failures.push(
        `  pnpm-workspace.yaml overrides.${name} is ${spec}; the Effect train is ${pinned}.`
      );
    }
  }
  return group("The Effect train disagrees with itself", failures);
};

/**
 * The compiler train, and the promise that each of its versions has one source:
 * the catalog for `typescript`, the root manifest for the three tools.
 */
const checkToolchain = (
  catalog: Mapping,
  manifests: ReadonlyArray<Manifest>
): ReadonlyArray<string> => {
  const rootManifest = manifests.find(
    (manifest) => manifest.file === "package.json"
  );
  if (rootManifest === undefined) return ["No root package.json."];

  const dev = dependencies(rootManifest, "devDependencies");
  const tools = [
    "@effect/tsgo",
    "oxlint",
    "oxlint-tsgolint",
    "@oxlint/plugins",
  ] as const;
  const typescript = catalog.get("typescript");
  const failures: Array<string> = [];

  if (typescript === undefined) {
    failures.push("  pnpm-workspace.yaml catalog has no `typescript` entry.");
  } else if (!exactVersion.test(typescript)) {
    failures.push(
      `  catalog.typescript is ${typescript}; the train must be an exact version.`
    );
  }

  const pins = new Map<string, string>();
  for (const name of tools) {
    const spec = dev[name];
    if (spec === undefined) {
      failures.push(`  root package.json devDependencies.${name} is missing.`);
      continue;
    }
    if (!exactVersion.test(spec)) {
      failures.push(
        `  root package.json devDependencies.${name} is ${spec}; the train must be exact.`
      );
      continue;
    }
    pins.set(name, spec);
  }
  if (
    pins.has("oxlint") &&
    pins.get("oxlint") !== pins.get("@oxlint/plugins")
  ) {
    failures.push(
      `  oxlint is ${pins.get("oxlint")} but @oxlint/plugins is ${pins.get("@oxlint/plugins")}; they share a release.`
    );
  }
  if (typescript !== undefined) pins.set("typescript", typescript);

  // A package that pins one of these to its own version is a second source of
  // truth, and the next bump moves only one of them.
  for (const manifest of manifests) {
    if (manifest.file === "package.json") continue;
    for (const field of dependencyFields) {
      for (const [name, spec] of Object.entries(
        dependencies(manifest, field)
      )) {
        const pin = pins.get(name);
        if (pin === undefined || spec === "catalog:" || spec === pin) continue;
        failures.push(
          `  ${manifest.file} ${field}.${name} is ${spec}; the train pins ${pin}. Use "catalog:".`
        );
      }
    }
  }
  return group("The compiler train disagrees with itself", failures);
};

const checkPatches = (patches: Mapping): ReadonlyArray<string> => {
  const failures: Array<string> = [];
  for (const [selector, patch] of patches) {
    if (!existsSync(join(root, patch))) {
      failures.push(`  ${selector} names ${patch}, which does not exist.`);
      continue;
    }
    const at = selector.lastIndexOf("@");
    if (at <= 0) {
      failures.push(`  ${selector} is not a \`name@version\` selector.`);
      continue;
    }
    const name = selector.slice(0, at);
    const version = selector.slice(at + 1);
    const installed = join(root, "node_modules", name, "package.json");
    if (!existsSync(installed)) {
      failures.push(
        `  ${selector} names a package that is not installed; pnpm applied no patch.`
      );
      continue;
    }
    // SAFETY: this is an installed package's own manifest; a missing `version`
    // fails the comparison below rather than passing it.
    const resolved = (
      JSON.parse(readFileSync(installed, "utf8")) as { version?: string }
    ).version;
    if (resolved !== version) {
      failures.push(
        `  ${selector} is installed at ${resolved}; the patch does not apply to it.`
      );
    }
  }
  return group("A dependency patch is not applied", failures);
};

/**
 * The checks are only guards if they can fail. These fixtures pin that: a clean
 * pair must pass, and a drifted pair must be reported. `pnpm check` runs them on
 * every push, so a refactor that makes a check vacuous fails here.
 */
const selfTest = () => {
  const catalog = new Map<string, string>([
    ["effect", "4.0.0"],
    ["typescript", "7.0.2"],
  ]);
  const rootFixture: Manifest = {
    file: "package.json",
    json: {
      devDependencies: {
        "@effect/tsgo": "0.47.2",
        oxlint: "1.82.0",
        "oxlint-tsgolint": "7.0.2001",
        "@oxlint/plugins": "1.82.0",
      },
    },
  };
  const clean: Manifest = {
    file: "a/package.json",
    json: {
      dependencies: { effect: "catalog:", "@effect/sql-pg": "catalog:" },
      devDependencies: { typescript: "catalog:" },
    },
  };
  const driftedEffect: Manifest = {
    file: "b/package.json",
    json: { dependencies: { "@effect/sql-pg": "4.0.1" } },
  };
  const driftedTool: Manifest = {
    file: "c/package.json",
    json: { devDependencies: { typescript: "6.0.0" } },
  };

  assert.deepEqual(
    checkEffectTrain(catalog, new Map(), [clean, rootFixture]),
    []
  );
  assert.deepEqual(checkToolchain(catalog, [rootFixture, clean]), []);
  assert.notDeepEqual(
    checkEffectTrain(catalog, new Map(), [driftedEffect]),
    []
  );
  assert.notDeepEqual(checkToolchain(catalog, [rootFixture, driftedTool]), []);
};

selfTest();

const workspace = source("pnpm-workspace.yaml");
const catalog = readMapping(workspace, "catalog");
const overrides = readMapping(workspace, "overrides");
const patches = readMapping(workspace, "patchedDependencies");
const manifests = readManifests();

const failures = [
  ...checkEffectTrain(catalog, overrides, manifests),
  ...checkToolchain(catalog, manifests),
  ...checkPatches(patches),
];

if (failures.length > 0) {
  console.error(failures.join("\n").replace(/^\n/, ""));
  console.error(
    "\nAGENTS.md's stack contract explains why these move together; `docs/adr/0005` covers the compiler train."
  );
  process.exit(1);
}

const rootManifest = manifests.find(
  (manifest) => manifest.file === "package.json"
);
const dev =
  rootManifest === undefined
    ? {}
    : dependencies(rootManifest, "devDependencies");
console.log(
  `Toolchain: effect ${catalog.get("effect")}, typescript ${catalog.get("typescript")}, ` +
    `oxlint ${dev["oxlint"]}, tsgolint ${dev["oxlint-tsgolint"]}, ` +
    `tsgo ${dev["@effect/tsgo"]}.`
);
