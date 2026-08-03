import {
  CONTAINER_ID,
  CONTAINER_STYLES,
  FADE_DURATION_MS,
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
} from "./types";
import { compact } from "./utils";

type CleanupContainer = HTMLDivElement & { _feebloCleanup?: () => void };

export class Embed {
  options: EmbedOptions;
  container: HTMLDivElement;
  organizationId: string;
  private readonly iframe: HTMLIFrameElement;
  readonly logger: Logger;
  private identity: NormalizedUserIdentity | null;
  private isLoaded = false;
  private isOpen = false;
  private pendingBoard: string | null;
  private context: Record<string, string> = {};
  private cleanupPositioning: (() => void) | null = null;
  private currentTrigger: HTMLElement | null = null;
  private escHandler: ((e: KeyboardEvent) => void) | null = null;
  private outsideClickHandler: ((e: MouseEvent) => void) | null = null;

  constructor(organizationId: string, options: EmbedOptions) {
    this.organizationId = organizationId;
    this.options = options;
    this.logger = createLogger(options.debug === true);
    this.identity = options.user
      ? normalizeUserIdentity(options.user)
      : null;
    this.pendingBoard = options.defaultBoard ?? null;
    this.iframe = createIframe(organizationId, options, this.logger);
    this.container = this.createContainer();

    if (this.logger.enabled) {
      this.logger("lifecycle", "construct", { organizationId });
    }
  }

  private createContainer(): HTMLDivElement {
    const { root, containerStyles, onError, onHeightChange, onClose } =
      this.options;

    const existing = document.getElementById(
      CONTAINER_ID
    ) as CleanupContainer | null;
    existing?._feebloCleanup?.();
    existing?.remove();

    const container = document.createElement("div");
    container.id = CONTAINER_ID;
    Object.assign(container.style, CONTAINER_STYLES, containerStyles);
    container.appendChild(this.iframe);

    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== iframeOrigin(this.iframe)) {
        return;
      }

      const message = event.data as IncomingMessage;
      if (this.logger.enabled) {
        this.logger(
          "message",
          "in",
          message?.event,
          (message as { data?: unknown } | undefined)?.data
        );
      }

      switch (message?.event) {
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
          break;
        case "WIDGET_OPENED":
          emitWidgetEvent("widgetOpened", message.data, this.logger);
          break;
        case "WIDGET_CLOSED":
          // The host owns the close state and emits widgetClosed exactly once.
          break;
        case "IDENTITY_CHANGED":
          if (message.data) {
            emitWidgetEvent("identityChanged", message.data, this.logger);
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
    );

    window.addEventListener("message", handleMessage);
    (container as CleanupContainer)._feebloCleanup = () => {
      window.removeEventListener("message", handleMessage);
    };

    (root ?? document.body).appendChild(container);
    return container;
  }

  private markReady(): void {
    if (this.isLoaded) {
      return;
    }
    this.isLoaded = true;
    this.sendIdentify();
    this.sendContext();
    this.flushPendingBoard();
    emitWidgetEvent("widgetReady", undefined, this.logger);
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
    if (this.isOpen) {
      return;
    }

    this.isOpen = true;
    this.currentTrigger = trigger ?? null;
    this.container.style.display = "";

    if (trigger) {
      this.cleanupPositioning = createFloatingInstance(
        trigger,
        this.container,
        this.logger
      );
    }

    this.context = { ...this.context, ...metadata };
    if (metadata.board) {
      this.pendingBoard = metadata.board;
    }
    this.addCloseListeners();

    this.flushPendingBoard();
    this.sendContext();

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

    setTimeout(() => {
      if (!this.isOpen) {
        this.container.style.display = "none";
      }
    }, FADE_DURATION_MS);
    this.post({ event: "HIDE" });
    emitWidgetEvent("widgetClosed", undefined, this.logger);
  }

  setBoard(board: string): void {
    if (this.isLoaded && this.isOpen) {
      this.sendSetBoard(board);
    } else {
      this.pendingBoard = board;
    }
  }

  private sendSetBoard(board: string): void {
    this.post({ event: "SET_BOARD", data: { board } });
  }

  private flushPendingBoard(): void {
    if (!(this.isLoaded && this.pendingBoard)) {
      return;
    }
    this.sendSetBoard(this.pendingBoard);
    this.pendingBoard = null;
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
      if (e.key === "Escape") {
        this.close();
      }
    };
    this.outsideClickHandler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        this.currentTrigger &&
        !this.container.contains(target) &&
        this.currentTrigger !== target
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

  destroy(): void {
    this.removeCloseListeners();
    this.cleanupPositioning?.();
    this.cleanupPositioning = null;

    const container = document.getElementById(
      CONTAINER_ID
    ) as CleanupContainer | null;
    container?._feebloCleanup?.();
    container?.remove();
    if (this.logger.enabled) {
      this.logger("lifecycle", "destroy");
    }
  }
}
