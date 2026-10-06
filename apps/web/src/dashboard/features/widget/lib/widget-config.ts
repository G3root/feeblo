import type { WidgetModule, WidgetMode } from "@feeblo/feedback-widget/config";

/**
 * The widget builder's vocabulary and the embed strings it produces.
 *
 * The dashboard never persists widget settings: the widget is configured by
 * the host page that embeds the SDK, so the page's job is to describe the
 * chosen setup as copy-paste output. Everything here is pure so the strings
 * can be asserted without a browser.
 */

/** Every module the iframe understands, in their default order. */
export const WIDGET_MODULES = [
  "feedback",
  "updates",
] as const satisfies readonly WidgetModule[];

export const WIDGET_MODULE_LABELS = {
  feedback: "Feedback",
  updates: "Updates",
} as const satisfies Record<WidgetModule, string>;

export const WIDGET_MODE_LABELS = {
  feedback: "Feedback widget",
  hub: "Hub",
  updates: "Updates widget",
} as const satisfies Record<WidgetMode, string>;

/** Where the SDK renders its launcher; `none` leaves the launcher out. */
export type WidgetLauncher = "bottom-left" | "bottom-right" | "none";

export type WidgetTheme = "light" | "dark";

export const WIDGET_SDK_SCRIPT_URL = "https://unpkg.com/@feeblo/sdk";

/** One row of the builder: a module and whether it is part of the widget. */
export interface WidgetModuleEntry {
  enabled: boolean;
  id: WidgetModule;
}

export interface WidgetDraft {
  launcher: WidgetLauncher;
  /** Every module in display order; enabled ones become the widget's tabs. */
  modules: WidgetModuleEntry[];
  theme: WidgetTheme;
}

/** The resolved shape the snippet, the prompt, and the preview consume. */
export interface WidgetEmbedConfig {
  mode: WidgetMode;
  /** Enabled modules in order. Only meaningful for `mode: "hub"`. */
  modules: WidgetModule[];
  placement?: Exclude<WidgetLauncher, "none">;
  theme: WidgetTheme;
}

export interface WidgetInstallTarget {
  /** The deployment serving the widget iframe, without a trailing slash. */
  baseUrl: string;
  organizationId: string;
}

export function createWidgetDraft(theme: WidgetTheme): WidgetDraft {
  return {
    launcher: "bottom-right",
    modules: WIDGET_MODULES.map((id) => ({ enabled: true, id })),
    theme,
  };
}

export function enabledWidgetModules(
  entries: readonly WidgetModuleEntry[]
): WidgetModule[] {
  return entries.filter((entry) => entry.enabled).map((entry) => entry.id);
}

/**
 * Flip one module. The last enabled module stays on — a widget with nothing
 * to show has no valid SDK config (`normalizeWidgetConfig` rejects an empty
 * hub, and the page should not offer the state in the first place).
 */
export function toggleWidgetModule(
  draft: WidgetDraft,
  module: WidgetModule
): WidgetDraft {
  const enabledCount = draft.modules.filter((entry) => entry.enabled).length;
  return {
    ...draft,
    modules: draft.modules.map((entry) => {
      if (entry.id !== module) {
        return entry;
      }
      if (entry.enabled && enabledCount === 1) {
        return entry;
      }
      return { ...entry, enabled: !entry.enabled };
    }),
  };
}

export function moveWidgetModule(
  entries: readonly WidgetModuleEntry[],
  from: number,
  to: number
): WidgetModuleEntry[] {
  const next = [...entries];
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= next.length ||
    to >= next.length
  ) {
    return next;
  }
  const [entry] = next.splice(from, 1);
  if (entry === undefined) {
    return next;
  }
  next.splice(to, 0, entry);
  return next;
}

/** Map the enabled modules onto the iframe's `mode` plus `modules`. */
export function widgetEmbedConfig(draft: WidgetDraft): WidgetEmbedConfig {
  const modules = enabledWidgetModules(draft.modules);
  const config: WidgetEmbedConfig = {
    mode: modules.length > 1 ? "hub" : (modules[0] ?? "feedback"),
    modules,
    theme: draft.theme,
  };
  if (draft.launcher !== "none") {
    config.placement = draft.launcher;
  }
  return config;
}

/** The order the widget opens on, for the UI badge and the prompt copy. */
export function describeWidgetModules(
  modules: readonly WidgetModule[]
): string {
  const labels = modules.map((module) => WIDGET_MODULE_LABELS[module]);
  if (labels.length === 0) {
    return "No modules";
  }
  if (labels.length === 1) {
    return `${labels[0]} only`;
  }
  return `${labels.join(" and ")}, with ${labels[0]} first`;
}

export function isWidgetLauncher(value: string): value is WidgetLauncher {
  return (
    value === "bottom-left" || value === "bottom-right" || value === "none"
  );
}

export function isWidgetTheme(value: string): value is WidgetTheme {
  return value === "light" || value === "dark";
}

const WIDGET_LAUNCHER_DESCRIPTIONS = {
  "bottom-left": "Launcher in the bottom-left corner.",
  "bottom-right": "Launcher in the bottom-right corner.",
  none: "No launcher — open the widget from your own button.",
} as const satisfies Record<WidgetLauncher, string>;

export function describeWidgetLauncher(launcher: WidgetLauncher): string {
  return WIDGET_LAUNCHER_DESCRIPTIONS[launcher];
}

export type WidgetDraftAction =
  | { type: "moveModule"; from: number; to: number }
  | { type: "setLauncher"; launcher: WidgetLauncher }
  | { type: "setTheme"; theme: WidgetTheme }
  | { type: "toggleModule"; module: WidgetModule };

/**
 * The builder's state transitions. Keeping them here (rather than inline in
 * the components) is what lets the rules above be asserted directly.
 */
export function widgetDraftReducer(
  draft: WidgetDraft,
  action: WidgetDraftAction
): WidgetDraft {
  switch (action.type) {
    case "moveModule":
      return {
        ...draft,
        modules: moveWidgetModule(draft.modules, action.from, action.to),
      };
    case "setLauncher":
      return { ...draft, launcher: action.launcher };
    case "setTheme":
      return { ...draft, theme: action.theme };
    case "toggleModule":
      return toggleWidgetModule(draft, action.module);
    default:
      return draft;
  }
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * The auto-init script tag. `data-feeblo-modules` is only emitted for hub —
 * the SDK rejects `modules` alongside a single-module mode.
 */
export function buildScriptSnippet(
  target: WidgetInstallTarget,
  config: WidgetEmbedConfig
): string {
  const attributes = [
    "  async",
    `  src="${WIDGET_SDK_SCRIPT_URL}"`,
    `  data-feeblo-organization-id="${target.organizationId}"`,
    `  data-feeblo-base-url="${stripTrailingSlash(target.baseUrl)}"`,
  ];
  if (config.mode === "hub") {
    attributes.push(
      `  data-feeblo-mode="hub"`,
      `  data-feeblo-modules="${config.modules.join(",")}"`
    );
  } else {
    attributes.push(`  data-feeblo-mode="${config.mode}"`);
  }
  if (config.placement !== undefined) {
    attributes.push(`  data-feeblo-placement="${config.placement}"`);
  }
  attributes.push(`  data-feeblo-theme="${config.theme}"`);
  return `<script\n${attributes.join("\n")}\n></script>`;
}

/** The npm package form, for apps that bundle their JavaScript. */
export function buildInitSnippet(
  target: WidgetInstallTarget,
  config: WidgetEmbedConfig
): string {
  const options = [
    `  organizationId: "${target.organizationId}",`,
    `  baseUrl: "${stripTrailingSlash(target.baseUrl)}",`,
    `  mode: "${config.mode}",`,
  ];
  if (config.mode === "hub") {
    options.push(
      `  modules: [${config.modules.map((module) => `"${module}"`).join(", ")}],`
    );
  }
  if (config.placement !== undefined) {
    options.push(`  placement: "${config.placement}",`);
  }
  options.push(`  theme: "${config.theme}",`);
  return [
    'import { Feeblo } from "@feeblo/sdk";',
    "",
    "Feeblo.init({",
    ...options,
    "});",
  ].join("\n");
}

/**
 * The prompt a person hands to their coding agent. It repeats the settings
 * (an agent reading only the prompt must not have to ask) and stops at
 * installation: no Feeblo secret is minted, stored, or mentioned here.
 */
export function buildAgentPrompt(
  target: WidgetInstallTarget,
  config: WidgetEmbedConfig
): string {
  const baseUrl = stripTrailingSlash(target.baseUrl);
  const securityUrl = `${baseUrl}/${target.organizationId}/settings/security`;
  const launcher =
    config.placement === "bottom-left"
      ? "bottom-left corner"
      : "bottom-right corner";
  const verification = [
    config.placement === undefined
      ? "- Opening the widget from your own trigger shows the widget."
      : `- The launcher appears in the ${launcher}.`,
    `- ${describeWidgetModules(config.modules)}.`,
    "- No console errors.",
  ];
  if (config.modules.length > 1) {
    verification.splice(
      2,
      0,
      "- Switching modules inside the widget works without a page reload."
    );
  }

  return [
    "# Install the Feeblo feedback widget",
    "",
    "Install Feeblo's feedback widget in this codebase, then verify it in the browser.",
    "",
    "## Widget settings",
    "",
    `- Organization ID: ${target.organizationId}`,
    `- Widget host: ${baseUrl}`,
    `- Modules: ${describeWidgetModules(config.modules)}`,
    `- ${describeWidgetLauncher(config.placement ?? "none")}`,
    `- Theme: ${config.theme}`,
    "",
    "## 1. Add the SDK",
    "",
    "Use the project's package manager:",
    "",
    "```sh",
    "pnpm add @feeblo/sdk",
    "```",
    "",
    "If the project has no build step, add this snippet to every page instead:",
    "",
    "```html",
    buildScriptSnippet(target, config),
    "```",
    "",
    "## 2. Initialize it once",
    "",
    "Call `Feeblo.init` once on the client, after the app mounts. In React put it in an effect in the root layout or provider so it never runs during server rendering. Do not initialize it a second time.",
    "",
    "```ts",
    buildInitSnippet(target, config),
    "```",
    "",
    "## 3. Verify",
    "",
    ...verification,
    "",
    "## Notes",
    "",
    `- Signed-in users can be attributed by minting a short-lived SSO JWT on your server. Configure it in Feeblo under Settings -> Security: ${securityUrl}`,
    "- Never put the Feeblo signing secret in client-side code.",
    "- Keep the change limited to installing the widget.",
  ].join("\n");
}
