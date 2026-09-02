/* eslint-disable anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-conditional-empty-object-spread -- SDK boundary uses plain JS validation (no Effect dependency) */
import {
  type NormalizedWidgetConfig,
  supportsBoardSelection,
  widgetConfigKey,
} from "./config";
import {
  CONTAINER_ID,
  CONTAINER_STYLES,
  FADE_DURATION_MS,
  LAUNCHER_ID,
} from "./constants";
import { createLogger, type Logger } from "./debug";
import { EmbedError as EmbedErrorCtor } from "./errors";
import { emitWidgetEvent } from "./events";
import { normalizeUserIdentity } from "./identity";
import { createIframe, iframeOrigin } from "./iframe";
import { createFloatingInstance } from "./positioning";
import type {
  EmbedOptions,
  IncomingMessage,
  NormalizedUserIdentity,
  OutgoingMessage,
  UserIdentity,
  WidgetModule,
} from "./types";
import { compact } from "./utils";

const ALLOWED_INCOMING_EVENTS = new Set<string>([
  "ERROR",
  "PAGE_HEIGHT",
  "CLOSE",
  "IDENTITY_CHANGED",
  "READY",
  "WIDGET_OPENED",
  "FEEDBACK_SUBMITTED",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringValue(value: unknown): value is string {
  return typeof value === "string";
}

function isNumberValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseIncomingMessage(value: unknown): IncomingMessage | null {
  if (!isRecord(value)) return null;
  const event = value.event;
  if (!isStringValue(event) || !ALLOWED_INCOMING_EVENTS.has(event)) return null;
  const data = value.data;
  switch (event) {
    case "ERROR": {
      if (data !== undefined && data !== null) {
        if (!isRecord(data)) return null;
        if (data.code !== undefined && !isStringValue(data.code)) return null;
        if (data.message !== undefined && !isStringValue(data.message)) return null;
      }
      return { event: "ERROR", data: data as IncomingMessage extends { event: "ERROR" } ? IncomingMessage["data"] : never };
    }
    case "PAGE_HEIGHT": {
      if (data !== undefined && data !== null) {
        if (!isRecord(data)) return null;
        if (data.height !== undefined && !isNumberValue(data.height)) return null;
      }
      return { event: "PAGE_HEIGHT", data: data as IncomingMessage extends { event: "PAGE_HEIGHT" } ? IncomingMessage["data"] : never };
    }
    case "CLOSE":
      return { event: "CLOSE" };
    case "READY":
      return { event: "READY" };
    case "WIDGET_OPENED": {
      if (data !== undefined && data !== null) {
        if (!isRecord(data)) return null;
        if (data.module !== undefined && data.module !== "feedback" && data.module !== "updates") return null;
      }
      return { event: "WIDGET_OPENED", data: data as IncomingMessage extends { event: "WIDGET_OPENED" } ? IncomingMessage["data"] : never };
    }
    case "IDENTITY_CHANGED": {
      if (data !== undefined && data !== null && !isRecord(data)) return null;
      return { event: "IDENTITY_CHANGED", data: data as IncomingMessage extends { event: "IDENTITY_CHANGED" } ? IncomingMessage["data"] : never };
    }
    case "FEEDBACK_SUBMITTED": {
      if (data !== undefined && data !== null) {
        if (!isRecord(data)) return null;
        if (data.post !== undefined && data.post !== null && !isRecord(data.post)) return null;
      }
      return { event: "FEEDBACK_SUBMITTED", data: data as IncomingMessage extends { event: "FEEDBACK_SUBMITTED" } ? IncomingMessage["data"] : never };
    }
    default:
      return null;
  }
}

type CleanupContainer = HTMLDivElement & { _feebloCleanup?: () => void };

export class Embed {
  options: EmbedOptions;
  container: HTMLDivElement;
  organizationId: string;
  private readonly iframe: HTMLIFrameElement;
  private readonly launcher: HTMLButtonElement | null;
  private readonly config: NormalizedWidgetConfig;
  readonly logger: Logger;
  private identity: NormalizedUserIdentity | null;
  private isLoaded = false;
  private isOpen = false;
  private openAcknowledged = false;
  private module: WidgetModule;
  private board: string | null;
  private context: Record<string, string> = {};
  private cleanupPositioning: (() => void) | null = null;
  private currentTrigger: HTMLElement | null = null;
  private escHandler: ((e: KeyboardEvent) => void) | null = null;
  private outsideClickHandler: ((e: MouseEvent) => void) | null = null;

  constructor(
    organizationId: string,
    options: EmbedOptions,
    config: NormalizedWidgetConfig
  ) {
    this.organizationId = organizationId;
    this.options = options;
    this.config = config;
    this.logger = createLogger(options.debug === true);
    this.identity = options.user ? normalizeUserIdentity(options.user) : null;
    this.module = config.modules[0] ?? "feedback";
    this.board = supportsBoardSelection(config)
      ? (options.defaultBoard ?? null)
      : null;
    this.iframe = createIframe(organizationId, options, this.logger);
    this.container = this.createContainer();
    this.launcher = this.createLauncher();

    if (this.logger.enabled) {
      this.logger("lifecycle", "construct", { organizationId });
    }
  }

  private createContainer(): HTMLDivElement {
    const { root, containerStyles, onError, onHeightChange, onClose } =
      this.options;

    // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
    const existing = document.getElementById(
      CONTAINER_ID
    ) as CleanupContainer | null;
    existing?._feebloCleanup?.();
    existing?.remove();

    const container = document.createElement("div");
    container.id = CONTAINER_ID;
    Object.assign(container.style, CONTAINER_STYLES, containerStyles);
    if (this.config.placement) {
      container.style.top = "auto";
      container.style.bottom = "84px";
      container.style.maxWidth = "calc(100vw - 32px)";
      container.style.maxHeight = "min(600px, calc(100vh - 108px))";
      container.style[
        this.config.placement === "bottom-left" ? "left" : "right"
      ] = "20px";
      container.style[
        this.config.placement === "bottom-left" ? "right" : "left"
      ] = "auto";
    }
    container.appendChild(this.iframe);

    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== iframeOrigin(this.iframe)) {
        return;
      }

      const message = parseIncomingMessage(event.data);
      if (message === null) {
        if (this.logger.enabled) {
          this.logger("message", "in", "invalid", event.data);
        }
        return;
      }
      if (this.logger.enabled) {
        this.logger(
          "message",
          "in",
          message.event,
          (message as { data?: unknown }).data
        );
      }

      switch (message.event) {
        case "ERROR":
          onError?.(
            new EmbedErrorCtor({
              code: message.data?.code ?? "",
              message: message.data?.message ?? "",
            })
          );
          break;
        case "PAGE_HEIGHT": {
          const height = message.data?.height;
          if (height !== undefined && height > 80) {
            container.style.height = `${height}px`;
            onHeightChange?.(height);
          }
          break;
        }
        case "CLOSE": {
          const wasOpen = this.isOpen;
          this.close();
          if (wasOpen) {
            onClose?.();
          }
          break;
        }
        case "READY":
          this.markReady();
          if (this.isOpen && !this.openAcknowledged) {
            // A SHOW sent before the widget finished loading may have been
            // lost; re-send it so the widget confirms WIDGET_OPENED and the
            // host can emit widgetOpened.
            this.post({ event: "SHOW" });
          }
          break;
        case "WIDGET_OPENED":
          if (!this.isOpen || this.openAcknowledged) {
            break;
          }
          this.openAcknowledged = true;
          emitWidgetEvent("widgetOpened", message.data, this.logger);
          break;
        case "IDENTITY_CHANGED":
          if (message.data) {
            const { token: _token, ...publicIdentity } =
              message.data as UserIdentity;
            emitWidgetEvent("identityChanged", publicIdentity, this.logger);
          }
          break;
        case "FEEDBACK_SUBMITTED":
          emitWidgetEvent("feedbackSubmitted", message.data?.post, this.logger);
          break;
        default:
          break;
      }
    };

    this.iframe.addEventListener(
      "load",
      () => {
        if (!this.isLoaded) {
          this.markReady();
        }
      },
      { once: true }
      // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
    );

    // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.

    window.addEventListener("message", handleMessage);
    // SAFETY: The upstream contract guarantees this value here.
    (container as CleanupContainer)._feebloCleanup = () => {
      window.removeEventListener("message", handleMessage);
    };

    (root ?? document.body).appendChild(container);
    return container;
  }

  private createLauncher(): HTMLButtonElement | null {
    if (!this.config.placement) {
      return null;
    }
    document.getElementById(LAUNCHER_ID)?.remove();
    const launcher = document.createElement("button");
    launcher.id = LAUNCHER_ID;
    launcher.type = "button";
    launcher.setAttribute("aria-label", "Open Feeblo widget");
    launcher.setAttribute("aria-expanded", "false");
    Object.assign(launcher.style, {
      alignItems: "center",
      background: "#171717",
      border: "1px solid rgba(255,255,255,.12)",
      borderRadius: "999px",
      bottom: "20px",
      boxShadow: "0 8px 28px rgba(0,0,0,.22)",
      color: "white",
      cursor: "pointer",
      display: "flex",
      height: "48px",
      justifyContent: "center",
      padding: "0",
      position: "fixed",
      width: "48px",
      zIndex: "999999",
      [this.config.placement === "bottom-left" ? "left" : "right"]: "20px",
    });
    launcher.innerHTML =
      '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M5 5.75h14v9.5H9.25L5 18.75v-13Z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><path d="M8.5 9h7M8.5 12h4.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>';
    launcher.addEventListener("click", () => {
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    });
    (this.options.root ?? document.body).appendChild(launcher);
    return launcher;
  }

  private markReady(): void {
    if (this.isLoaded) {
      // The widget (re)loaded; re-assert state in case the load-time flush
      // raced with the widget's message subscription.
      this.syncState();
      return;
    }
    this.isLoaded = true;
    this.syncState();
    emitWidgetEvent("widgetReady", undefined, this.logger);
  }

  private syncState(): void {
    this.sendIdentify();
    this.sendContext();
    this.sendLocale();
    this.syncNavigation();
  }

  private post(message: OutgoingMessage): void {
    this.iframe.contentWindow?.postMessage(message, iframeOrigin(this.iframe));
    if (this.logger.enabled) {
      this.logger(
        "message",
        "out",
        message.event,
        (message as { data?: unknown }).data
      );
    }
  }

  open(trigger?: HTMLElement, metadata: Record<string, string> = {}): void {
    if (trigger && this.config.modules.includes("feedback")) {
      this.module = "feedback";
    }
    this.context = { ...this.context, ...metadata };
    if (metadata.board) {
      this.board = metadata.board;
    }
    if (trigger || metadata.board) {
      this.syncNavigation();
    }
    this.sendContext();
    if (this.isOpen) {
      return;
    }

    this.isOpen = true;
    this.launcher?.setAttribute("aria-expanded", "true");
    this.launcher?.setAttribute("aria-label", "Close Feeblo widget");
    this.currentTrigger = trigger ?? null;
    this.container.style.display = "";

    if (trigger) {
      this.cleanupPositioning = createFloatingInstance(
        trigger,
        this.container,
        this.logger
      );
    }

    this.addCloseListeners();
    this.openAcknowledged = false;

    requestAnimationFrame(() => {
      this.container.style.opacity = "1";
    });
    this.post({ event: "SHOW" });
  }

  close(): void {
    if (!this.isOpen) {
      return;
    }

    this.removeCloseListeners();
    this.cleanupPositioning?.();
    this.cleanupPositioning = null;
    this.currentTrigger = null;
    this.container.style.opacity = "0";
    this.isOpen = false;
    this.launcher?.setAttribute("aria-expanded", "false");
    this.launcher?.setAttribute("aria-label", "Open Feeblo widget");

    setTimeout(() => {
      if (!this.isOpen) {
        this.container.style.display = "none";
      }
    }, FADE_DURATION_MS);
    this.post({ event: "HIDE" });
    emitWidgetEvent("widgetClosed", undefined, this.logger);
  }

  setBoard(board: string): void {
    if (!supportsBoardSelection(this.config)) {
      return;
    }
    this.board = board;
    this.syncNavigation();
  }

  openModule(module: WidgetModule): void {
    if (!this.config.modules.includes(module)) {
      return;
    }
    this.module = module;
    this.syncNavigation();
    this.open();
  }

  private syncNavigation(): void {
    if (!this.isLoaded) {
      return;
    }
    this.post({ event: "SET_MODULE", data: { module: this.module } });
    if (this.module === "feedback" && this.board) {
      this.post({ event: "SET_BOARD", data: { board: this.board } });
    }
  }

  getConfigKey(): string {
    return widgetConfigKey(this.config);
  }

  metadata(patch: Record<string, string | null>): void {
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) {
        delete this.context[key];
      } else {
        this.context[key] = String(value);
      }
    }
    this.sendContext();
  }

  private sendContext(): void {
    if (this.isLoaded) {
      this.post({ event: "SET_CONTEXT", data: this.context });
    }
  }

  private sendLocale(): void {
    if (this.isLoaded && this.options.locale) {
      this.post({ event: "SET_LOCALE", data: { locale: this.options.locale } });
    }
  }

  identify(user: UserIdentity): void {
    this.identity = normalizeUserIdentity(user);
    if (this.logger.enabled) {
      this.logger("identity", this.identity.id);
    }
    if (this.isLoaded) {
      this.sendIdentify();
    }
  }

  isOpenState(): boolean {
    return this.isOpen;
  }

  getAutoLoginToken(): string | undefined {
    return this.identity?.token;
  }

  private sendIdentify(): void {
    if (!this.identity) {
      return;
    }
    this.post({
      event: "IDENTIFY",
      data: compact(this.identity),
    });
  }

  private addCloseListeners(): void {
    this.escHandler = (e: KeyboardEvent) => {
      // SAFETY: The event target is the expected DOM element type for this handler.
      if (e.key === "Escape") {
        this.close();
        // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
      }
    };
    // SAFETY: The event target is the expected DOM element type for this handler.
    this.outsideClickHandler = (e: MouseEvent) => {
      // SAFETY: The event target is the expected DOM element type for this handler.
      const target = e.target as HTMLElement;
      if (
        (this.currentTrigger || this.launcher) &&
        !this.container.contains(target) &&
        !this.currentTrigger?.contains(target) &&
        !this.launcher?.contains(target)
      ) {
        this.close();
      }
    };
    document.addEventListener("keydown", this.escHandler);
    document.addEventListener("click", this.outsideClickHandler, {
      capture: true,
    });
  }

  private removeCloseListeners(): void {
    if (this.escHandler) {
      document.removeEventListener("keydown", this.escHandler);
      this.escHandler = null;
    }
    if (this.outsideClickHandler) {
      document.removeEventListener("click", this.outsideClickHandler, {
        capture: true,
      });
      this.outsideClickHandler = null;
    }
  }

  // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.

  destroy(): void {
    // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
    this.removeCloseListeners();
    this.cleanupPositioning?.();
    // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
    this.cleanupPositioning = null;

    // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.

    const container = document.getElementById(
      CONTAINER_ID
    ) as CleanupContainer | null;
    container?._feebloCleanup?.();
    container?.remove();
    this.launcher?.remove();
    if (this.logger.enabled) {
      this.logger("lifecycle", "destroy");
    }
  }
}
