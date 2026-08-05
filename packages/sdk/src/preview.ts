import {
  Feeblo,
  type FeebloWidget,
  type UserIdentity,
  type WidgetMode,
  type WidgetModule,
  type WidgetPlacement,
} from "./index";

const DEFAULTS = {
  baseUrl: "http://localhost:3001",
  mode: "feedback" as WidgetMode,
  modules: ["feedback", "updates"] as WidgetModule[],
  organizationId: "demo-org",
  theme: "light",
};

interface PreviewConfig {
  baseUrl: string;
  mode: WidgetMode;
  modules: WidgetModule[];
  organizationId: string;
  placement?: WidgetPlacement | undefined;
  theme: string;
  user?: UserIdentity | undefined;
}

function isWidgetMode(value: string | null): value is WidgetMode {
  return value === "feedback" || value === "updates" || value === "hub";
}

function isWidgetModule(value: string): value is WidgetModule {
  return value === "feedback" || value === "updates";
}

function isWidgetPlacement(value: string | null): value is WidgetPlacement {
  return value === "bottom-left" || value === "bottom-right";
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Preview element not found: ${selector}`);
  }
  return element;
}

function readConfig(): PreviewConfig {
  const params = new URLSearchParams(window.location.search);
  const requestedMode = params.get("mode");
  const mode = isWidgetMode(requestedMode) ? requestedMode : DEFAULTS.mode;
  const requestedModules = (params.get("modules") ?? "")
    .split(",")
    .filter(isWidgetModule);
  const modules = [
    ...new Set(
      requestedModules.length > 0 ? requestedModules : DEFAULTS.modules
    ),
  ];
  const requestedPlacement = params.get("placement");
  const placement = isWidgetPlacement(requestedPlacement)
    ? requestedPlacement
    : undefined;
  const userId = params.get("userId")?.trim();
  const user: UserIdentity | undefined = userId
    ? {
        id: userId,
        email: params.get("email")?.trim() || undefined,
        name: params.get("name")?.trim() || undefined,
      }
    : undefined;

  return {
    baseUrl: params.get("baseUrl")?.trim() || DEFAULTS.baseUrl,
    mode,
    modules,
    organizationId: params.get("org")?.trim() || DEFAULTS.organizationId,
    placement,
    theme: params.get("theme")?.trim() || DEFAULTS.theme,
    user,
  };
}

const statusOutput = requiredElement<HTMLOutputElement>("#preview-status");
const urlOutput = requiredElement<HTMLOutputElement>("#url-output");
const embedRoot = requiredElement<HTMLElement>("#embed-root");
const organizationInput = requiredElement<HTMLInputElement>("#organization-id");
const baseUrlInput = requiredElement<HTMLInputElement>("#base-url");
const userIdInput = requiredElement<HTMLInputElement>("#user-id");
const userNameInput = requiredElement<HTMLInputElement>("#user-name");
const userEmailInput = requiredElement<HTMLInputElement>("#user-email");
const hubOptions = requiredElement<HTMLElement>("#hub-options");
const openFeedbackButton = requiredElement<HTMLButtonElement>("#open-feedback");
const openUpdatesButton = requiredElement<HTMLButtonElement>("#open-updates");
const productFeedbackButton =
  requiredElement<HTMLButtonElement>("#product-feedback");
const copyUrlButton = requiredElement<HTMLButtonElement>("#copy-url");

let widget: FeebloWidget;
const inputTimers = new WeakMap<HTMLInputElement, number>();

function updateUrl(patch: Record<string, string | undefined>): void {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(patch)) {
    if (value) {
      url.searchParams.set(key, value);
    } else {
      url.searchParams.delete(key);
    }
  }
  window.history.replaceState({}, "", url);
  initializePreview();
}

function setChoiceState(config: PreviewConfig): void {
  const values: Record<string, string> = {
    mode: config.mode,
    modules: config.modules.join(","),
    placement: config.placement ?? "",
    theme: config.theme,
  };
  for (const control of document.querySelectorAll<HTMLElement>(
    "[data-control]"
  )) {
    const name = control.dataset.control;
    if (!name) {
      continue;
    }
    for (const button of control.querySelectorAll<HTMLButtonElement>(
      "[data-value]"
    )) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.value === values[name])
      );
    }
  }
}

function syncControls(config: PreviewConfig): void {
  const values = new Map<HTMLInputElement, string>([
    [organizationInput, config.organizationId],
    [baseUrlInput, config.baseUrl],
    [userIdInput, config.user?.id ?? ""],
    [userNameInput, config.user?.name ?? ""],
    [userEmailInput, config.user?.email ?? ""],
  ]);
  for (const [input, value] of values) {
    if (document.activeElement !== input) {
      input.value = value;
    }
  }
  hubOptions.hidden = config.mode !== "hub";
  const enabledModules: WidgetModule[] =
    config.mode === "hub" ? config.modules : [config.mode];
  openFeedbackButton.disabled = !enabledModules.includes("feedback");
  openUpdatesButton.disabled = !enabledModules.includes("updates");
  setChoiceState(config);
  urlOutput.value = window.location.href;
  urlOutput.textContent = window.location.href;
}

function initializePreview(): void {
  const config = readConfig();
  Feeblo.destroy();
  syncControls(config);
  statusOutput.value = "initializing";
  statusOutput.textContent = "initializing";

  widget = Feeblo.init(config.organizationId, {
    baseUrl: config.baseUrl,
    mode: config.mode,
    ...(config.mode === "hub" ? { modules: config.modules } : {}),
    placement: config.placement,
    root: embedRoot,
    theme: config.theme,
    user: config.user,
    onError(error) {
      statusOutput.value = error.code;
      statusOutput.textContent = error.code;
      console.error("[Preview] embed error", error);
    },
    onHeightChange(height) {
      console.debug("[Preview] embed height changed", height);
    },
  });
}

function bindChoiceControls(): void {
  for (const control of document.querySelectorAll<HTMLElement>(
    "[data-control]"
  )) {
    const name = control.dataset.control;
    if (!name) {
      continue;
    }
    for (const button of control.querySelectorAll<HTMLButtonElement>(
      "[data-value]"
    )) {
      button.addEventListener("click", () => {
        updateUrl({ [name]: button.dataset.value });
      });
    }
  }
}

function bindTextInput(input: HTMLInputElement): void {
  input.addEventListener("input", () => {
    const timer = inputTimers.get(input);
    window.clearTimeout(timer);
    inputTimers.set(
      input,
      window.setTimeout(() => {
        updateUrl({ [input.name]: input.value.trim() || undefined });
      }, 300)
    );
  });
}

Feeblo.on("*", (event) => {
  const { data, type, namespace } = event.detail;
  statusOutput.value = type;
  statusOutput.textContent = type;
  console.debug("[Preview] widget event", { data, type, namespace });
});

bindChoiceControls();
for (const input of [
  organizationInput,
  baseUrlInput,
  userIdInput,
  userNameInput,
  userEmailInput,
]) {
  bindTextInput(input);
}

requiredElement<HTMLButtonElement>("#open-widget").addEventListener(
  "click",
  () => {
    widget.open();
  }
);
requiredElement<HTMLButtonElement>("#close-widget").addEventListener(
  "click",
  () => {
    widget.close();
  }
);
openFeedbackButton.addEventListener("click", () => {
  widget.openModule("feedback");
});
openUpdatesButton.addEventListener("click", () => {
  widget.openModule("updates");
});
productFeedbackButton.addEventListener("click", () => {
  widget.open(productFeedbackButton);
});
copyUrlButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    copyUrlButton.textContent = "Copied";
  } catch {
    copyUrlButton.textContent = "Copy failed";
  }
  window.setTimeout(() => {
    copyUrlButton.textContent = "Copy";
  }, 1200);
});

window.addEventListener("popstate", initializePreview);
initializePreview();
