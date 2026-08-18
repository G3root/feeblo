import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EmbedError } from "../src/errors";
import { Feeblo } from "../src/index";
import { getCurrentEmbed, init } from "../src/instance";
import type { FeebloWidget } from "../src/types";

const MOCK_ORIGIN = "http://localhost:3001";
const fakePostMessage = vi.fn();

function createMockIframe(): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  iframe.src = "about:blank";
  Object.defineProperty(iframe, "contentWindow", {
    value: { postMessage: fakePostMessage },
    writable: true,
    configurable: true,
  });
  return iframe;
}

import * as iframeModule from "../src/iframe";
import * as positioningModule from "../src/positioning";

beforeEach(() => {
  vi.spyOn(iframeModule, "createIframe").mockImplementation(() =>
    createMockIframe()
  );
  vi.spyOn(iframeModule, "iframeOrigin").mockImplementation(() => MOCK_ORIGIN);
  vi.spyOn(iframeModule, "resolveBaseUrl").mockImplementation(
    () => MOCK_ORIGIN
  );
  vi.spyOn(positioningModule, "createFloatingInstance").mockImplementation(
    () => () => {}
  );
});

function postWidgetMessage<T>(data: T): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: MOCK_ORIGIN,
      data,
    })
  );
}

describe("init", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Feeblo.destroy();
    fakePostMessage.mockClear();
  });

  it("throws INVALID_ORG when organizationId is empty", () => {
    expect(() => init("")).toThrow(
      expect.objectContaining({ code: "INVALID_ORG" })
    );
  });

  it("returns a widget handle with expected methods", () => {
    const widget = init("org_test");

    expect(widget).toBeDefined();
    expect(widget.open).toEqual(expect.any(Function));
    expect(widget.close).toEqual(expect.any(Function));
    expect(widget.identify).toEqual(expect.any(Function));
    expect(widget.setBoard).toEqual(expect.any(Function));
    expect(widget.openModule).toEqual(expect.any(Function));
    expect(widget.destroy).toEqual(expect.any(Function));
  });

  it("accepts an InitConfig object", () => {
    const widget = init({ organizationId: "org_cfg", theme: "dark" });

    expect(widget).toBeDefined();
    expect(widget.open).toEqual(expect.any(Function));
  });

  it("creates the embed container in the DOM", () => {
    init("org_test");
    const container = document.getElementById("feeblo-embed-container");

    expect(container).not.toBeNull();
    expect(container?.tagName).toBe("DIV");
  });

  it("removes previous container when called again with a different org", () => {
    init("org_first");
    const firstContainer = document.getElementById("feeblo-embed-container");

    init("org_second");
    const secondContainer = document.getElementById("feeblo-embed-container");

    const containers = document.querySelectorAll("#feeblo-embed-container");
    expect(containers.length).toBe(1);
    expect(secondContainer).not.toBeNull();
    expect(secondContainer).not.toBe(firstContainer);
  });

  it("reuses the existing embed for the same organizationId", () => {
    const w1 = init("org_reuse");
    const embedBefore = getCurrentEmbed();
    const w2 = init("org_reuse");
    const embedAfter = getCurrentEmbed();

    expect(w1).toBeDefined();
    expect(w2).toBeDefined();
    expect(embedBefore).not.toBeNull();
    expect(embedAfter).toBe(embedBefore);
  });

  it("replaces the embed when the mode changes for the same organization", () => {
    init("org_mode", { mode: "feedback" });
    const feedbackEmbed = getCurrentEmbed();

    init("org_mode", { mode: "updates" });

    expect(getCurrentEmbed()).not.toBe(feedbackEmbed);
  });

  it("identifies user when passed in options", () => {
    const user = { id: "user_1", email: "test@example.com" };
    init("org_user", { user });

    postWidgetMessage({ event: "READY" });

    const identifyCall = fakePostMessage.mock.calls.find(
      ([msg]: [any]) => msg?.event === "IDENTIFY"
    );
    expect(identifyCall).toBeDefined();
  });
});

describe("FeebloWidget methods", () => {
  let widget: FeebloWidget;

  beforeEach(() => {
    fakePostMessage.mockClear();
    widget = init("org_methods");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Feeblo.destroy();
    fakePostMessage.mockClear();
  });

  it("open shows the container and sends SHOW message", () => {
    widget.open();

    expect(fakePostMessage).toHaveBeenCalled();
    const showMsg = fakePostMessage.mock.calls.find(
      ([msg]: [any]) => msg?.event === "SHOW"
    );
    expect(showMsg).toBeDefined();
  });

  it("close hides the container and sends HIDE message", () => {
    widget.open();
    fakePostMessage.mockClear();

    widget.close();

    const hideMsg = fakePostMessage.mock.calls.find(
      ([msg]: [any]) => msg?.event === "HIDE"
    );
    expect(hideMsg).toBeDefined();
  });

  it("setBoard sends SET_BOARD message when loaded and open", () => {
    postWidgetMessage({ event: "READY" });
    widget.open();
    fakePostMessage.mockClear();

    widget.setBoard("roadmap");

    const boardMsg = fakePostMessage.mock.calls.find(
      ([msg]: [any]) => msg?.event === "SET_BOARD"
    );
    expect(boardMsg).toBeDefined();
    expect(boardMsg?.[0].data.board).toBe("roadmap");
  });

  it("setBoard is ignored when feedback is not the landing module", () => {
    Feeblo.destroy();
    widget = init("org_updates_board", { mode: "updates" });
    postWidgetMessage({ event: "READY" });
    widget.open();
    fakePostMessage.mockClear();

    widget.setBoard("roadmap");

    expect(fakePostMessage).not.toHaveBeenCalledWith(
      { event: "SET_BOARD", data: { board: "roadmap" } },
      MOCK_ORIGIN
    );
  });

  it("identify sends IDENTIFY message when loaded", () => {
    postWidgetMessage({ event: "READY" });
    fakePostMessage.mockClear();

    widget.identify({ id: "user_x", firstName: "Jane" });

    const identifyMsg = fakePostMessage.mock.calls.find(
      ([msg]: [any]) => msg?.event === "IDENTIFY"
    );
    expect(identifyMsg).toBeDefined();
  });

  it("sends context metadata to the iframe", () => {
    postWidgetMessage({ event: "READY" });
    fakePostMessage.mockClear();

    widget.metadata({ page: "/pricing", source: "nav" });

    expect(fakePostMessage).toHaveBeenCalledWith(
      {
        event: "SET_CONTEXT",
        data: { page: "/pricing", source: "nav" },
      },
      MOCK_ORIGIN
    );
  });

  it("methods return the widget for chaining", () => {
    expect(widget.open()).toBe(widget);
    expect(widget.close()).toBe(widget);
    expect(widget.setBoard("b")).toBe(widget);
    expect(widget.openModule("feedback")).toBe(widget);
  });

  it("renders and toggles a placed launcher", () => {
    Feeblo.destroy();
    widget = init("org_launcher", { placement: "bottom-right" });
    const launcher = document.getElementById("feeblo-widget-launcher");

    expect(launcher).not.toBeNull();
    launcher?.click();
    expect(widget.isOpen()).toBe(true);
    expect(launcher?.getAttribute("aria-expanded")).toBe("true");
    launcher?.click();
    expect(widget.isOpen()).toBe(false);
    expect(launcher?.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens enabled Hub modules and ignores disabled modules", () => {
    Feeblo.destroy();
    widget = init("org_hub", { mode: "hub", modules: ["updates"] });
    postWidgetMessage({ event: "READY" });
    fakePostMessage.mockClear();

    widget.openModule("feedback");
    expect(widget.isOpen()).toBe(false);

    widget.openModule("updates");
    expect(widget.isOpen()).toBe(true);
    expect(fakePostMessage).toHaveBeenCalledWith(
      { event: "SET_MODULE", data: { module: "updates" } },
      MOCK_ORIGIN
    );
  });

  it("feedback triggers select the Feedback module in Hub", () => {
    Feeblo.destroy();
    widget = init("org_trigger_hub", {
      mode: "hub",
      modules: ["updates", "feedback"],
    });
    postWidgetMessage({ event: "READY" });
    fakePostMessage.mockClear();
    const trigger = document.createElement("button");
    trigger.setAttribute("data-feeblo-feedback", "");

    widget.open(trigger);

    expect(fakePostMessage).toHaveBeenCalledWith(
      { event: "SET_MODULE", data: { module: "feedback" } },
      MOCK_ORIGIN
    );
  });

  it("destroy removes the container from DOM", () => {
    expect(document.getElementById("feeblo-embed-container")).not.toBeNull();

    widget.destroy();

    expect(document.getElementById("feeblo-embed-container")).toBeNull();
  });

  it("open does nothing when already open", () => {
    widget.open();
    fakePostMessage.mockClear();

    widget.open();

    const showMessages = fakePostMessage.mock.calls.filter(
      ([msg]: [any]) => msg?.event === "SHOW"
    );
    expect(showMessages.length).toBe(0);
  });

  it("close does nothing when already closed", () => {
    widget.open();
    widget.close();
    fakePostMessage.mockClear();

    widget.close();

    const hideMessages = fakePostMessage.mock.calls.filter(
      ([msg]: [any]) => msg?.event === "HIDE"
    );
    expect(hideMessages.length).toBe(0);
  });
});

describe("Embed postMessage callbacks", () => {
  let widget: FeebloWidget;

  afterEach(() => {
    vi.restoreAllMocks();
    Feeblo.destroy();
    fakePostMessage.mockClear();
  });

  it("calls onError callback when ERROR message is received", () => {
    const onError = vi.fn();
    widget = init("org_err", { onError });

    postWidgetMessage({
      event: "ERROR",
      data: { code: "WIDGET_ERROR", message: "Something went wrong" },
    });

    expect(onError).toHaveBeenCalledTimes(1);
    // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
    const err = onError.mock.calls[0]?.[0] as EmbedError;
    expect(err).toBeInstanceOf(EmbedError);
    expect(err.code).toBe("WIDGET_ERROR");
  });

  it("calls onHeightChange callback when PAGE_HEIGHT message is received", () => {
    const onHeightChange = vi.fn();
    widget = init("org_height", { onHeightChange });

    postWidgetMessage({
      event: "PAGE_HEIGHT",
      data: { height: 500 },
    });

    expect(onHeightChange).toHaveBeenCalledWith(500);
  });

  it("does not call onHeightChange for heights <= 80", () => {
    const onHeightChange = vi.fn();
    widget = init("org_height2", { onHeightChange });

    postWidgetMessage({
      event: "PAGE_HEIGHT",
      data: { height: 80 },
    });

    expect(onHeightChange).not.toHaveBeenCalled();
  });

  it("calls onClose callback and closes widget on CLOSE message", () => {
    const onClose = vi.fn();
    widget = init("org_close", { onClose });
    widget.open();

    postWidgetMessage({ event: "CLOSE" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores messages from other origins", () => {
    const onError = vi.fn();
    widget = init("org_origin", { onError });

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://evil.example.com",
        data: { event: "ERROR", data: { code: "X", message: "bad" } },
      })
    );

    expect(onError).not.toHaveBeenCalled();
  });
});

describe("defaultBoard handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Feeblo.destroy();
    fakePostMessage.mockClear();
  });

  it("defers SET_BOARD for defaultBoard until READY", () => {
    init("org_db", { defaultBoard: "roadmap" });

    const boardBeforeReady = fakePostMessage.mock.calls.find(
      ([msg]: [any]) => msg?.event === "SET_BOARD"
    );
    expect(boardBeforeReady).toBeUndefined();

    postWidgetMessage({ event: "READY" });

    const boardMsg = fakePostMessage.mock.calls.find(
      ([msg]: [any]) => msg?.event === "SET_BOARD"
    );
    expect(boardMsg).toBeDefined();
    expect(boardMsg?.[0].data.board).toBe("roadmap");
  });

  it("sends defaultBoard for hub whose first module is feedback", () => {
    init("org_db_hub", {
      mode: "hub",
      modules: ["feedback", "updates"],
      defaultBoard: "roadmap",
    });
    postWidgetMessage({ event: "READY" });

    const boardMsg = fakePostMessage.mock.calls.find(
      ([msg]: [any]) => msg?.event === "SET_BOARD"
    );
    expect(boardMsg).toBeDefined();
    expect(boardMsg?.[0].data.board).toBe("roadmap");
  });

  it("sends a queued feedback module before its queued board", () => {
    const widget = init("org_db_module_order", {
      mode: "hub",
      modules: ["feedback", "updates"],
      defaultBoard: "roadmap",
    });
    widget.openModule("feedback");
    fakePostMessage.mockClear();

    postWidgetMessage({ event: "READY" });

    const navigationEvents = fakePostMessage.mock.calls
      .map(([message]: [any]) => message?.event)
      .filter((event) => event === "SET_MODULE" || event === "SET_BOARD");
    expect(navigationEvents).toEqual(["SET_MODULE", "SET_BOARD"]);
  });

  it("ignores defaultBoard in updates mode", () => {
    init("org_db_updates", {
      mode: "updates",
      defaultBoard: "roadmap",
    });
    postWidgetMessage({ event: "READY" });

    const boardMsg = fakePostMessage.mock.calls.find(
      ([msg]: [any]) => msg?.event === "SET_BOARD"
    );
    expect(boardMsg).toBeUndefined();
  });

  it("ignores defaultBoard for hub whose first module is updates", () => {
    init("org_db_hub_updates_first", {
      mode: "hub",
      modules: ["updates", "feedback"],
      defaultBoard: "roadmap",
    });
    postWidgetMessage({ event: "READY" });

    const boardMsg = fakePostMessage.mock.calls.find(
      ([msg]: [any]) => msg?.event === "SET_BOARD"
    );
    expect(boardMsg).toBeUndefined();
  });
});

describe("navigation sync ordering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Feeblo.destroy();
    fakePostMessage.mockClear();
  });

  function navigationAndShowEvents(): string[] {
    return fakePostMessage.mock.calls
      .map(([message]: [any]) => message?.event)
      .filter(
        (event) =>
          event === "SET_MODULE" || event === "SET_BOARD" || event === "SHOW"
      );
  }

  function boardMessage(): { board: string } | undefined {
    const call = fakePostMessage.mock.calls.find(
      ([msg]: [any]) => msg?.event === "SET_BOARD"
    );
    return call?.[0].data;
  }

  it("re-asserts the configured board when openModule('feedback') reopens a ready, closed widget", () => {
    const widget = init("org_sync_reopen", {
      mode: "hub",
      modules: ["feedback", "updates"],
      defaultBoard: "roadmap",
    });
    postWidgetMessage({ event: "READY" });
    widget.open();
    widget.close();
    fakePostMessage.mockClear();

    widget.openModule("feedback");

    expect(navigationAndShowEvents()).toEqual([
      "SET_MODULE",
      "SET_BOARD",
      "SHOW",
    ]);
    expect(boardMessage()?.board).toBe("roadmap");
  });

  it("re-asserts the board when openModule('feedback') is called while already open", () => {
    const widget = init("org_sync_open", {
      mode: "hub",
      modules: ["feedback", "updates"],
      defaultBoard: "roadmap",
    });
    postWidgetMessage({ event: "READY" });
    widget.open();
    fakePostMessage.mockClear();

    widget.openModule("feedback");

    expect(navigationAndShowEvents()).toEqual(["SET_MODULE", "SET_BOARD"]);
  });

  it("re-asserts the board after the feedback module when opening via trigger", () => {
    const widget = init("org_sync_trigger", {
      mode: "hub",
      modules: ["feedback", "updates"],
      defaultBoard: "roadmap",
    });
    postWidgetMessage({ event: "READY" });
    widget.open();
    widget.close();
    fakePostMessage.mockClear();

    const trigger = document.createElement("button");
    trigger.setAttribute("data-feeblo-feedback", "");
    widget.open(trigger);

    expect(navigationAndShowEvents()).toEqual([
      "SET_MODULE",
      "SET_BOARD",
      "SHOW",
    ]);
    expect(boardMessage()?.board).toBe("roadmap");
  });

  it("applies setBoard immediately when loaded, even while closed", () => {
    const widget = init("org_sync_setboard", {
      mode: "hub",
      modules: ["feedback", "updates"],
    });
    postWidgetMessage({ event: "READY" });
    widget.close();
    fakePostMessage.mockClear();

    widget.setBoard("changelog");

    expect(navigationAndShowEvents()).toEqual(["SET_MODULE", "SET_BOARD"]);
    expect(boardMessage()?.board).toBe("changelog");

    fakePostMessage.mockClear();
    widget.open();
    expect(navigationAndShowEvents()).toEqual(["SHOW"]);
  });

  it("plain open() does not re-send navigation when the state is unchanged", () => {
    const widget = init("org_sync_plain", {
      mode: "hub",
      modules: ["feedback", "updates"],
      defaultBoard: "roadmap",
    });
    postWidgetMessage({ event: "READY" });
    widget.close();
    fakePostMessage.mockClear();

    widget.open();

    expect(navigationAndShowEvents()).toEqual(["SHOW"]);
  });

  it("does not send SET_BOARD when navigating to the updates module", () => {
    const widget = init("org_sync_updates", {
      mode: "hub",
      modules: ["feedback", "updates"],
      defaultBoard: "roadmap",
    });
    postWidgetMessage({ event: "READY" });
    fakePostMessage.mockClear();

    widget.openModule("updates");

    const events = fakePostMessage.mock.calls.map(([msg]: [any]) => msg?.event);
    expect(events).toContain("SET_MODULE");
    expect(events).not.toContain("SET_BOARD");
    expect(events).toContain("SHOW");
  });
});

describe("ready handshake", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Feeblo.destroy();
    fakePostMessage.mockClear();
  });

  function showMessages(): number {
    return fakePostMessage.mock.calls.filter(
      ([message]: [any]) => message?.event === "SHOW"
    ).length;
  }

  it("re-posts SHOW when the widget becomes ready while the host is already open", () => {
    const widget = init("org_handshake_open", {});
    widget.open();
    fakePostMessage.mockClear();

    postWidgetMessage({ event: "READY" });

    expect(showMessages()).toBe(1);
  });

  it("does not re-post SHOW on READY when the widget acknowledged the open", () => {
    const widget = init("org_handshake_ack", {});
    widget.open();
    postWidgetMessage({ event: "WIDGET_OPENED", data: { module: "feedback" } });
    fakePostMessage.mockClear();

    postWidgetMessage({ event: "READY" });

    expect(showMessages()).toBe(0);
  });

  it("emits widgetOpened when a pre-ready open is acknowledged after READY", () => {
    const widget = init("org_handshake_event", {});
    const listener = vi.fn();
    window.addEventListener("widgetOpened", listener);

    widget.open();
    postWidgetMessage({ event: "READY" });
    postWidgetMessage({ event: "WIDGET_OPENED", data: { module: "feedback" } });

    // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
    expect(listener).toHaveBeenCalledTimes(1);
    // SAFETY: The upstream contract guarantees this value here.
    const detail = (listener.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.data).toEqual({ module: "feedback" });
    window.removeEventListener("widgetOpened", listener);
  });

  it("emits widgetOpened at most once when READY races an acknowledged open", () => {
    const widget = init("org_handshake_once", {});
    const listener = vi.fn();
    window.addEventListener("widgetOpened", listener);

    // The widget subscribed early: open()'s SHOW was received and acknowledged
    // before the host processed the queued READY message.
    widget.open();
    postWidgetMessage({ event: "WIDGET_OPENED", data: { module: "feedback" } });
    fakePostMessage.mockClear();
    postWidgetMessage({ event: "READY" });

    expect(showMessages()).toBe(0);
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("widgetOpened", listener);
  });

  it("emits widgetOpened once when both SHOW messages are acknowledged", () => {
    const widget = init("org_handshake_duplicate", {});
    const listener = vi.fn();
    window.addEventListener("widgetOpened", listener);

    widget.open();
    postWidgetMessage({ event: "READY" });
    postWidgetMessage({ event: "WIDGET_OPENED", data: { module: "feedback" } });
    postWidgetMessage({ event: "WIDGET_OPENED", data: { module: "feedback" } });

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("widgetOpened", listener);
  });

  it("ignores a delayed open acknowledgement after the widget closes", () => {
    const widget = init("org_handshake_closed", {});
    const listener = vi.fn();
    window.addEventListener("widgetOpened", listener);

    widget.open();
    widget.close();
    postWidgetMessage({ event: "WIDGET_OPENED", data: { module: "feedback" } });

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener("widgetOpened", listener);
  });
});

describe("Widget events via postMessage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Feeblo.destroy();
    fakePostMessage.mockClear();
  });

  it("emits widgetReady event when READY message is received", () => {
    const handler = vi.fn();
    window.addEventListener("widgetReady", handler);

    init("org_ready");
    postWidgetMessage({ event: "READY" });

    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener("widgetReady", handler);
  });

  it("emits widgetOpened event when WIDGET_OPENED message is received", () => {
    const handler = vi.fn();
    window.addEventListener("widgetOpened", handler);

    const widget = init("org_widget_open");
    widget.open();
    postWidgetMessage({ event: "WIDGET_OPENED", data: { module: "feedback" } });

    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener("widgetOpened", handler);
  });

  it("does not expose identity tokens through identityChanged events", () => {
    const handler = vi.fn();
    window.addEventListener("identityChanged", handler);

    init("org_identity_changed");
    postWidgetMessage({
      event: "IDENTITY_CHANGED",
      data: { id: "user_1", email: "person@example.com", token: "secret" },
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0].detail.data).toEqual({
      id: "user_1",
      email: "person@example.com",
    });
    window.removeEventListener("identityChanged", handler);
  });

  it("emits feedbackSubmitted event when FEEDBACK_SUBMITTED message is received", () => {
    const handler = vi.fn();
    window.addEventListener("feedbackSubmitted", handler);

    init("org_submit");
    postWidgetMessage({
      event: "FEEDBACK_SUBMITTED",
      data: {
        post: { boardId: "b1", boardName: "Roadmap", title: "Dark mode" },
      },
    });

    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener("feedbackSubmitted", handler);
  });

  it("emits feedbackSubmitted for every submission", () => {
    const handler = vi.fn();
    window.addEventListener("feedbackSubmitted", handler);

    init("org_once");
    postWidgetMessage({
      event: "FEEDBACK_SUBMITTED",
      data: {
        post: { boardId: "b1", boardName: "Roadmap", title: "First" },
      },
    });
    postWidgetMessage({
      event: "FEEDBACK_SUBMITTED",
      data: {
        post: { boardId: "b2", boardName: "Changelog", title: "Second" },
      },
    });

    expect(handler).toHaveBeenCalledTimes(2);
    window.removeEventListener("feedbackSubmitted", handler);
  });
});

describe("Feeblo namespace", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Feeblo.destroy();
    fakePostMessage.mockClear();
  });

  it("Feeblo.init is callable", () => {
    expect(Feeblo.init).toEqual(expect.any(Function));
    Feeblo.init("org_ns");
  });

  it("Feeblo.open opens the current widget", () => {
    Feeblo.init("org_ns_open");
    Feeblo.open();

    expect(fakePostMessage).toHaveBeenCalled();
  });

  it("Feeblo.close closes the current widget", () => {
    Feeblo.init("org_ns_close");
    Feeblo.open();
    fakePostMessage.mockClear();

    Feeblo.close();

    const hideMsg = fakePostMessage.mock.calls.find(
      ([msg]: [any]) => msg?.event === "HIDE"
    );
    expect(hideMsg).toBeDefined();
  });

  it("Feeblo.identify delegates to embed", () => {
    Feeblo.init("org_ns_identify");
    postWidgetMessage({ event: "READY" });
    fakePostMessage.mockClear();

    Feeblo.identify({ id: "user_z" });

    const identifyMsg = fakePostMessage.mock.calls.find(
      ([msg]: [any]) => msg?.event === "IDENTIFY"
    );
    expect(identifyMsg).toBeDefined();
  });

  it("Feeblo.on subscribes to widget events", () => {
    const callback = vi.fn();
    Feeblo.init("org_ns_on");

    Feeblo.on("widgetReady", callback);
    postWidgetMessage({ event: "READY" });

    expect(callback).toHaveBeenCalledTimes(1);
    Feeblo.off("widgetReady", callback);
  });

  it("Feeblo.off unsubscribes from widget events", () => {
    const callback = vi.fn();
    Feeblo.init("org_ns_off");

    Feeblo.on("widgetReady", callback);
    Feeblo.off("widgetReady", callback);

    postWidgetMessage({ event: "READY" });
    expect(callback).not.toHaveBeenCalled();
  });

  it("Feeblo.setBoard delegates to embed", () => {
    Feeblo.init("org_ns_board");
    postWidgetMessage({ event: "READY" });
    Feeblo.open();
    fakePostMessage.mockClear();

    Feeblo.setBoard("changelog");

    const boardMsg = fakePostMessage.mock.calls.find(
      ([msg]: [any]) => msg?.event === "SET_BOARD"
    );
    expect(boardMsg).toBeDefined();
  });

  it("Feeblo.version is a non-empty string", () => {
    expect(Feeblo.version).toEqual(expect.any(String));
    expect(Feeblo.version.length).toBeGreaterThan(0);
  });

  it("Feeblo.organizationId is the branding function", () => {
    expect(Feeblo.organizationId).toEqual(expect.any(Function));
    expect(Feeblo.organizationId("x")).toBe("x");
  });

  it("Feeblo methods are chainable", () => {
    Feeblo.init("org_chain");

    const result = Feeblo.open().close().open();
    expect(result).toBe(Feeblo);
  });
});
