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
 * 2. The compiler train is declared exactly once. `tsrs` lives in the
 *    catalog; `@effect/tsgo`, `oxlint` and `@oxlint/plugins` live in the root
 *    `package.json`, `oxlint` and `@oxlint/plugins` share a release, and no
 *    package pins any of them to something else. `oxlint-tsgolint` must appear
 *    nowhere: `pnpm lint` runs the type-aware pass on `tsrs`, so an installed
 *    `tsgolint` is a second program builder nothing would use.
 * 3. Every `patchedDependencies` selector names a version that is installed. A
 *    selector that names no installed version is a no-op, and the package then
 *    runs unpatched with the install still succeeding. The block itself may be
 *    absent: a patch is removable, and an empty set is expressed by not having
 *    the block rather than by leaving a selector that names nothing.
 *
 * The pairing between `@effect/tsgo` and the compiler/Oxlint is not checked
 * here: `effect-tsgo patch` (run from `prepare` on every install) refuses a
 * mismatch, so a second, weaker copy of that rule would only add drift.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = import.meta.dirname;

/** The Effect release train. `@effect/tsgo` versions itself. */
const effectPackage = /^@effect\/(?!tsgo$)/;

/**
 * Tools the gate must not depend on any more. `oxlint-tsgolint` built the
 * type-aware program until `@effect/tsgo@0.70.0`, whose `--tsrs-lint` runs that
 * pass on `tsrs` instead; a declaration left behind would install a second
 * program builder that nothing invokes.
 */
const retired = ["oxlint-tsgolint"] as const;

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
/**
 * Reads a top-level mapping. `optional` is for a block pnpm accepts as absent;
 * `patchedDependencies` is empty whenever no dependency needs a patch.
 */
const readMapping = (yaml: string, key: string, optional = false): Mapping => {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => line === `${key}:`);

  if (start === -1) {
    if (optional) return new Map();
    fail(`pnpm-workspace.yaml has no top-level \`${key}:\` block.`);
  }

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

  return (
    tracked
      .filter(
        (file) => file === "package.json" || file.endsWith("/package.json")
      )
      // Installed agent skills carry their own `package.json` — the anti-slop
      // installer ships a copy of the plugin it vendors, with upstream's peer
      // ranges — and none of them is a workspace package. Their versions are the
      // skill's business, not the train this file guards.
      .filter((file) => !file.startsWith(".agents/"))
      .map((file) => ({
        file,
        // SAFETY: package.json is JSON by definition. Only the dependency maps
        // above are read, and a field of any other shape reads as absent.
        json: JSON.parse(source(file)) as ManifestJson,
      }))
  );
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

  // Every manifest says `catalog:`, so the catalog is where this train actually
  // lives. A bump that moves `effect` and leaves `@effect/sql-pg` behind is
  // invisible to the manifest loop below.
  for (const [name, spec] of catalog) {
    if (name === "effect" || !effectPackage.test(name)) continue;

    if (spec !== pinned) {
      failures.push(
        `  pnpm-workspace.yaml catalog.${name} is ${spec}; the Effect train is ${pinned}.`
      );
    }
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

  const tools = ["@effect/tsgo", "oxlint", "@oxlint/plugins"] as const;

  const compiler = catalog.get("tsrs");
  const failures: Array<string> = [];

  if (compiler === undefined) {
    failures.push("  pnpm-workspace.yaml catalog has no `tsrs` entry.");
  } else if (!exactVersion.test(compiler)) {
    failures.push(
      `  catalog.tsrs is ${compiler}; the train must be an exact version.`
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

  if (compiler !== undefined) pins.set("tsrs", compiler);

  // The compiler is catalogued, so the root declaration must point at the
  // catalog rather than repeat the version — otherwise the catalog could move
  // and the root would keep calling the old binary.
  const rootCompiler = dev["tsrs"];

  if (rootCompiler !== "catalog:") {
    failures.push(
      `  root package.json devDependencies.tsrs is ${rootCompiler ?? "missing"}; it must be "catalog:", because the catalog owns the compiler version.`
    );
  }

  // A tool that is also catalogued would be a second source; if one is moved
  // there, it must agree with the root pin.
  for (const name of tools) {
    const catalogued = catalog.get(name);
    const pin = pins.get(name);

    if (catalogued !== undefined && pin !== undefined && catalogued !== pin) {
      failures.push(
        `  pnpm-workspace.yaml catalog.${name} is ${catalogued}; the root package.json pins ${pin}.`
      );
    }
  }

  // Each of these has exactly one source: the catalog for `tsrs`, the root
  // manifest for the tools. A package that repeats the version — even the right
  // one — is a second source, and the next bump moves only one of them.
  for (const manifest of manifests) {
    if (manifest.file === "package.json") continue;

    for (const field of dependencyFields) {
      for (const [name, spec] of Object.entries(
        dependencies(manifest, field)
      )) {
        if (!pins.has(name)) continue;

        if (spec === "catalog:") {
          if (catalog.get(name) === undefined) {
            failures.push(
              `  ${manifest.file} ${field}.${name} is "catalog:", but the catalog has no ${name} entry.`
            );
          }

          continue;
        }

        failures.push(
          catalog.has(name)
            ? `  ${manifest.file} ${field}.${name} is ${spec}; ${name} is pinned in the catalog. Use "catalog:".`
            : `  ${manifest.file} ${field}.${name} is ${spec}; ${name} is pinned in the root package.json and must not be declared twice.`
        );
      }
    }
  }

  return group("The compiler train disagrees with itself", failures);
};

/**
 * A package may not declare a tool the gate has retired, because a dependency
 * nothing invokes is indistinguishable from one that still does. The
 * declaration can hide behind an `npm:` alias — `"lint-engine":
 * "npm:oxlint-tsgolint@7.0.2007"` installs the retired package under another
 * name — so the spec is read as well as the key. Aliases of anything else are
 * ordinary, and a value that names no package (a range, a tag, a workspace or
 * catalog reference) is not an alias at all.
 */
const aliasTarget = (spec: string): string | undefined => {
  if (!spec.startsWith("npm:")) return undefined;

  const target = spec.slice("npm:".length);
  // A scoped name opens with `@`, so its own `@` is not the version separator.
  const separator = target.indexOf("@", 1);

  return separator === -1 ? target : target.slice(0, separator);
};

/**
 * Where a retired tool may still be declared: every dependency field of every
 * manifest, the manifests' `npm:` aliases, and the workspace `overrides` block,
 * which can re-add a package no manifest names.
 */
const checkRetired = (
  manifests: ReadonlyArray<Manifest>,
  overrides: Mapping
): ReadonlyArray<string> => {
  const failures: Array<string> = [];

  for (const manifest of manifests) {
    for (const field of dependencyFields) {
      for (const [name, spec] of Object.entries(
        dependencies(manifest, field)
      )) {
        const target = aliasTarget(spec);

        for (const tool of retired) {
          if (name !== tool && target !== tool) continue;

          failures.push(
            `  ${manifest.file} ${field}.${name} is declared; the type-aware pass runs on tsrs, so nothing invokes it.`
          );
        }
      }
    }
  }

  for (const tool of retired) {
    if (overrides.has(tool)) {
      failures.push(
        `  pnpm-workspace.yaml overrides.${tool} is declared; the type-aware pass runs on tsrs, so nothing invokes it.`
      );
    }
  }

  return group("A retired tool is still declared", failures);
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
    ["tsrs", "0.20.0-ts7.1.0-beta"],
  ]);

  const rootFixture: Manifest = {
    file: "package.json",
    json: {
      devDependencies: {
        "@effect/tsgo": "0.47.2",
        oxlint: "1.82.0",
        "@oxlint/plugins": "1.82.0",
        tsrs: "catalog:",
      },
    },
  };

  const clean: Manifest = {
    file: "a/package.json",
    json: {
      dependencies: { effect: "catalog:", "@effect/sql-pg": "catalog:" },
      devDependencies: { tsrs: "catalog:" },
    },
  };

  const driftedEffect: Manifest = {
    file: "b/package.json",
    json: { dependencies: { "@effect/sql-pg": "4.0.1" } },
  };

  const driftedTool: Manifest = {
    file: "c/package.json",
    json: { devDependencies: { tsrs: "0.18.0-ts7.1.0-dev.20261019" } },
  };

  // A package may not repeat the pin even when it repeats it correctly.
  const repeatedTool: Manifest = {
    file: "d/package.json",
    json: { devDependencies: { tsrs: "0.20.0-ts7.1.0-beta" } },
  };

  // The root may not repeat the catalog version either, and a root that names
  // a version is how the catalog and the installed binary drift apart.
  const driftedRoot: Manifest = {
    file: "package.json",
    json: {
      devDependencies: {
        "@effect/tsgo": "0.47.2",
        oxlint: "1.82.0",
        "@oxlint/plugins": "1.82.0",
        tsrs: "0.20.0-ts7.1.0-beta",
      },
    },
  };

  const driftedCatalog = new Map(catalog);
  driftedCatalog.set("@effect/sql-pg", "4.0.1");
  const driftedCatalogTool = new Map(catalog);
  driftedCatalogTool.set("oxlint", "1.81.0");

  assert.deepEqual(
    checkEffectTrain(catalog, new Map(), [clean, rootFixture]),
    []
  );
  assert.deepEqual(checkToolchain(catalog, [rootFixture, clean]), []);
  assert.notDeepEqual(
    checkEffectTrain(catalog, new Map(), [driftedEffect]),
    []
  );
  assert.notDeepEqual(
    checkEffectTrain(driftedCatalog, new Map(), [clean, rootFixture]),
    []
  );
  assert.notDeepEqual(checkToolchain(catalog, [rootFixture, driftedTool]), []);
  assert.notDeepEqual(checkToolchain(catalog, [rootFixture, repeatedTool]), []);
  assert.notDeepEqual(checkToolchain(catalog, [driftedRoot, clean]), []);
  assert.notDeepEqual(
    checkToolchain(driftedCatalogTool, [rootFixture, clean]),
    []
  );

  // The retired-tool check has to fail on a declaration and pass on its
  // absence, or removing `oxlint-tsgolint` from the gate would be unguarded.
  const retiredFixture: Manifest = {
    file: "e/package.json",
    json: { devDependencies: { "oxlint-tsgolint": "7.0.2001" } },
  };

  const aliasedRetired: Manifest = {
    file: "f/package.json",
    json: {
      devDependencies: { "lint-engine": "npm:oxlint-tsgolint@7.0.2001" },
    },
  };

  // An alias of anything else is ordinary, and so is an alias with no version.
  const aliasedOther: Manifest = {
    file: "g/package.json",
    json: {
      devDependencies: {
        engine: "npm:oxlint@1.82.0",
        types: "npm:@types/node",
      },
    },
  };

  assert.deepEqual(
    checkRetired([clean, rootFixture, aliasedOther], new Map()),
    []
  );
  assert.notDeepEqual(checkRetired([retiredFixture], new Map()), []);
  assert.notDeepEqual(checkRetired([aliasedRetired], new Map()), []);
  assert.notDeepEqual(
    checkRetired([clean], new Map([["oxlint-tsgolint", "7.0.2001"]])),
    []
  );
};

selfTest();

const workspace = source("pnpm-workspace.yaml");

const catalog = readMapping(workspace, "catalog");

const overrides = readMapping(workspace, "overrides");

const patches = readMapping(workspace, "patchedDependencies", true);

const manifests = readManifests();

const failures = [
  ...checkEffectTrain(catalog, overrides, manifests),
  ...checkToolchain(catalog, manifests),
  ...checkRetired(manifests, overrides),
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
  `Toolchain: effect ${catalog.get("effect")}, tsrs ${catalog.get("tsrs")}, ` +
    `oxlint ${dev["oxlint"]}, tsgo ${dev["@effect/tsgo"]}.`
);
