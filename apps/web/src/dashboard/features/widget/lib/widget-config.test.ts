import { describe, expect, it } from "vitest";

import {
  buildAgentPrompt,
  buildIdentitySnippet,
  buildReactSnippet,
  buildScriptSnippet,
  buildSigningSnippet,
  createWidgetDraft,
  enabledWidgetModules,
  moveWidgetModule,
  toggleWidgetModule,
  widgetEmbedConfig,
  type WidgetDraft,
} from "./widget-config";

const target = {
  baseUrl: "https://app.example.com/",
  organizationId: "org_123",
};

const draftWith = (overrides: Partial<WidgetDraft> = {}): WidgetDraft => ({
  ...createWidgetDraft("light"),
  ...overrides,
});

describe("widgetEmbedConfig", () => {
  it("uses hub with the enabled order when both modules are on", () => {
    const config = widgetEmbedConfig(
      draftWith({
        modules: [
          { enabled: true, id: "updates" },
          { enabled: true, id: "feedback" },
        ],
      })
    );

    expect(config).toEqual({
      mode: "hub",
      modules: ["updates", "feedback"],
      placement: "bottom-right",
      theme: "light",
    });
  });

  it("drops to a single-module mode when one module is off", () => {
    const config = widgetEmbedConfig(
      draftWith({
        modules: [
          { enabled: false, id: "feedback" },
          { enabled: true, id: "updates" },
        ],
      })
    );

    expect(config.mode).toBe("updates");
    expect(config.modules).toEqual(["updates"]);
  });

  it("omits placement when the launcher is off", () => {
    const config = widgetEmbedConfig(draftWith({ launcher: "none" }));

    expect(config.placement).toBeUndefined();
  });
});

describe("toggleWidgetModule", () => {
  it("keeps the last enabled module on", () => {
    const draft = draftWith({
      modules: [
        { enabled: true, id: "feedback" },
        { enabled: false, id: "updates" },
      ],
    });

    const toggled = toggleWidgetModule(draft, "feedback");

    expect(enabledWidgetModules(toggled.modules)).toEqual(["feedback"]);
  });

  it("re-enables a module in its list position", () => {
    const draft = draftWith({
      modules: [
        { enabled: true, id: "updates" },
        { enabled: false, id: "feedback" },
      ],
    });

    const toggled = toggleWidgetModule(draft, "feedback");

    expect(enabledWidgetModules(toggled.modules)).toEqual([
      "updates",
      "feedback",
    ]);
  });
});

describe("moveWidgetModule", () => {
  it("moves an entry to another index", () => {
    const entries = draftWith().modules;

    expect(moveWidgetModule(entries, 0, 1).map((entry) => entry.id)).toEqual([
      "updates",
      "feedback",
    ]);
  });

  it("ignores out-of-range moves", () => {
    const entries = draftWith().modules;

    expect(moveWidgetModule(entries, 0, 5)).toEqual(entries);
    expect(moveWidgetModule(entries, 1, 1)).toEqual(entries);
  });
});

describe("install snippets", () => {
  const hubConfig = widgetEmbedConfig(
    draftWith({
      modules: [
        { enabled: true, id: "updates" },
        { enabled: true, id: "feedback" },
      ],
      theme: "dark",
    })
  );

  it("emits hub modules and strips the trailing slash from the host", () => {
    const snippet = buildScriptSnippet(target, hubConfig);

    expect(snippet).toContain('src="https://unpkg.com/@feeblo/sdk"');
    expect(snippet).toContain('data-feeblo-base-url="https://app.example.com"');
    expect(snippet).toContain('data-feeblo-mode="hub"');
    expect(snippet).toContain('data-feeblo-modules="updates,feedback"');
    expect(snippet).toContain('data-feeblo-placement="bottom-right"');
    expect(snippet).toContain('data-feeblo-theme="dark"');
  });

  it("omits modules and placement for a single-module mode", () => {
    const config = widgetEmbedConfig(
      draftWith({
        launcher: "none",
        modules: [
          { enabled: true, id: "feedback" },
          { enabled: false, id: "updates" },
        ],
      })
    );
    const snippet = buildScriptSnippet(target, config);
    const react = buildReactSnippet(target, config);

    expect(snippet).toContain('data-feeblo-mode="feedback"');
    expect(snippet).not.toContain("data-feeblo-modules");
    expect(snippet).not.toContain("data-feeblo-placement");
    expect(react).not.toContain("modules={");
    expect(react).not.toContain("placement=");
  });

  it("renders the provider props for hub mode", () => {
    const react = buildReactSnippet(target, hubConfig);

    expect(react).toContain(
      'import { FeebloProvider } from "@feeblo/sdk-react";'
    );
    expect(react).toContain('organizationId="org_123"');
    expect(react).toContain('baseUrl="https://app.example.com"');
    expect(react).toContain('mode="hub"');
    expect(react).toContain('modules={["updates", "feedback"]}');
    expect(react).toContain('placement="bottom-right"');
    expect(react).toContain('theme="dark"');
  });
});

describe("buildIdentitySnippet", () => {
  const config = widgetEmbedConfig(draftWith());

  it("adds the user to the React provider", () => {
    const snippet = buildIdentitySnippet(target, config, "react");

    expect(snippet).toContain("<FeebloProvider");
    expect(snippet).toContain('organizationId="org_123"');
    expect(snippet).toContain(
      "user={{ id: user.id, email: user.email, name: user.name, token }}"
    );
  });

  it("identifies the user after the script tag loads", () => {
    const snippet = buildIdentitySnippet(target, config, "vanilla");

    expect(snippet).toContain('window.addEventListener("load"');
    expect(snippet).toContain("Feeblo.identify({");
    expect(snippet).toContain("token,");
  });
});

describe("buildSigningSnippet", () => {
  it("binds the token to the workspace and shows the custom attribute shape", () => {
    const snippet = buildSigningSnippet("org_123");

    expect(snippet).toContain('setAudience("org_123")');
    expect(snippet).toContain('setExpirationTime("5m")');
    expect(snippet).toContain("customFields:");
    expect(snippet).toContain("companies:");
    expect(snippet).toContain("sub: user.id");
  });
});

describe("buildAgentPrompt", () => {
  const hubConfig = widgetEmbedConfig(
    draftWith({
      modules: [
        { enabled: true, id: "updates" },
        { enabled: true, id: "feedback" },
      ],
    })
  );

  it("carries the settings and the React install steps", () => {
    const prompt = buildAgentPrompt(target, hubConfig, "react");

    expect(prompt).toContain("Organization ID: org_123");
    expect(prompt).toContain("Widget host: https://app.example.com");
    expect(prompt).toContain("Updates and Feedback, with Updates first");
    expect(prompt).toContain("pnpm add @feeblo/sdk-react @feeblo/sdk");
    expect(prompt).toContain("FeebloProvider");
    expect(prompt).toContain(
      "https://app.example.com/org_123/settings/security"
    );
  });

  it("switches to the script tag for the vanilla install", () => {
    const prompt = buildAgentPrompt(
      target,
      widgetEmbedConfig(draftWith({ launcher: "none" })),
      "vanilla"
    );

    expect(prompt).toContain('data-feeblo-organization-id="org_123"');
    expect(prompt).toContain("Feeblo.open()");
    expect(prompt).not.toContain("pnpm add");
  });
});
