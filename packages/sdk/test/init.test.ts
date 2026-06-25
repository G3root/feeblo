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

vi.mock("../src/iframe", () => ({
  createIframe: vi.fn(() => createMockIframe()),
  iframeOrigin: vi.fn(() => MOCK_ORIGIN),
  resolveBaseUrl: vi.fn(() => MOCK_ORIGIN),
}));

vi.mock("../src/positioning", () => ({
  createFloatingInstance: vi.fn(() => () => {}),
}));

function postWidgetMessage(data: unknown): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: MOCK_ORIGIN,
      data,
    })
  );
}

describe("init", () => {
  afterEach(() => {
    Feeblo.destroy();
    fakePostMessage.mockClear();
  });

  it("throws INVALID_ORG when organizationId is empty", () => {
    expect(() => init("")).toThrow(EmbedError);
    try {
      init("");
    } catch (err) {
      expect((err as EmbedError).code).toBe("INVALID_ORG");
    }
  });

  it("returns a widget handle with expected methods", () => {
    const widget = init("org_test");

    expect(widget).toBeDefined();
    expect(typeof widget.open).toBe("function");
    expect(typeof widget.close).toBe("function");
    expect(typeof widget.identify).toBe("function");
    expect(typeof widget.setBoard).toBe("function");
    expect(typeof widget.destroy).toBe("function");
  });

  it("accepts an InitConfig object", () => {
    const widget = init({ organizationId: "org_cfg", theme: "dark" });

    expect(widget).toBeDefined();
    expect(typeof widget.open).toBe("function");
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

  it("identify sends IDENTIFY message when loaded", () => {
    postWidgetMessage({ event: "READY" });
    fakePostMessage.mockClear();

    widget.identify({ id: "user_x", firstName: "Jane" });

    const identifyMsg = fakePostMessage.mock.calls.find(
      ([msg]: [any]) => msg?.event === "IDENTIFY"
    );
    expect(identifyMsg).toBeDefined();
  });

  it("methods return the widget for chaining", () => {
    expect(widget.open()).toBe(widget);
    expect(widget.close()).toBe(widget);
    expect(widget.setBoard("b")).toBe(widget);
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

describe("Widget events via postMessage", () => {
  afterEach(() => {
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

    init("org_widget_open");
    postWidgetMessage({ event: "WIDGET_OPENED", data: { some: "data" } });

    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener("widgetOpened", handler);
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

  it("only emits feedbackSubmitted once per embed", () => {
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

    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener("feedbackSubmitted", handler);
  });
});

describe("Feeblo namespace", () => {
  afterEach(() => {
    Feeblo.destroy();
    fakePostMessage.mockClear();
  });

  it("Feeblo.init is callable", () => {
    expect(typeof Feeblo.init).toBe("function");
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
    expect(typeof Feeblo.version).toBe("string");
    expect(Feeblo.version.length).toBeGreaterThan(0);
  });

  it("Feeblo.organizationId is the branding function", () => {
    expect(typeof Feeblo.organizationId).toBe("function");
    expect(Feeblo.organizationId("x")).toBe("x");
  });

  it("Feeblo methods are chainable", () => {
    Feeblo.init("org_chain");

    const result = Feeblo.open().close().open();
    expect(result).toBe(Feeblo);
  });
});
