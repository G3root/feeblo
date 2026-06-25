import { afterEach, describe, expect, it, vi } from "vitest";
import { emitWidgetEvent, subscribe, unsubscribe } from "../src/events";
import type { FeebloEventDetail, SubmittedFeedback } from "../src/types";

describe("subscribe / unsubscribe", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const unsub of cleanups) {
      unsub();
    }
    cleanups.length = 0;
    vi.restoreAllMocks();
  });

  it("calls callback when a matching event is dispatched", () => {
    const callback = vi.fn();
    cleanups.push(subscribe("widgetReady", callback));

    emitWidgetEvent("widgetReady", undefined);

    expect(callback).toHaveBeenCalledTimes(1);
    const event = callback.mock.calls[0]?.[0] as CustomEvent<FeebloEventDetail>;
    expect(event.detail.type).toBe("widgetReady");
    expect(event.detail.namespace).toBe("feeblo");
  });

  it("returns an unsubscribe function that stops the listener", () => {
    const callback = vi.fn();
    const unsub = subscribe("widgetOpened", callback);

    unsub();

    emitWidgetEvent("widgetOpened", undefined);
    expect(callback).not.toHaveBeenCalled();
  });

  it("does not fire callback for a different event name", () => {
    const callback = vi.fn();
    cleanups.push(subscribe("widgetReady", callback));

    emitWidgetEvent("widgetOpened", undefined);

    expect(callback).not.toHaveBeenCalled();
  });

  it("unsubscribe removes a specific listener", () => {
    const callback = vi.fn();
    subscribe("feedbackSubmitted", callback);
    unsubscribe("feedbackSubmitted", callback);

    emitWidgetEvent("feedbackSubmitted", {
      boardId: "b1",
      boardName: "Roadmap",
      title: "Dark mode",
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it("passes event data through the CustomEvent detail", () => {
    const callback = vi.fn();
    cleanups.push(subscribe("feedbackSubmitted", callback));

    const data: SubmittedFeedback = {
      boardId: "board_1",
      boardName: "Feature Requests",
      title: "Add dark mode support",
    };
    emitWidgetEvent("feedbackSubmitted", data);

    const event = callback.mock.calls[0]?.[0] as CustomEvent<
      FeebloEventDetail<"feedbackSubmitted">
    >;
    expect(event.detail.data).toEqual(data);
  });

  it("fires for widgetReady with undefined data", () => {
    const callback = vi.fn();
    cleanups.push(subscribe("widgetReady", callback));

    emitWidgetEvent("widgetReady", undefined);

    const event = callback.mock.calls[0]?.[0] as CustomEvent<FeebloEventDetail>;
    expect(event.detail.data).toBeUndefined();
  });
});

describe("subscribe wildcard (*)", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const unsub of cleanups) {
      unsub();
    }
    cleanups.length = 0;
    vi.restoreAllMocks();
  });

  it("listens to all three widget events", () => {
    const callback = vi.fn();
    cleanups.push(subscribe("*", callback));

    emitWidgetEvent("widgetReady", undefined);
    emitWidgetEvent("widgetOpened", undefined);
    emitWidgetEvent("feedbackSubmitted", {
      boardId: "b1",
      boardName: "Changelog",
      title: "v2.0",
    });

    expect(callback).toHaveBeenCalledTimes(3);
  });

  it("returns an unsubscribe function that stops all listeners", () => {
    const callback = vi.fn();
    const unsub = subscribe("*", callback);

    unsub();

    emitWidgetEvent("widgetReady", undefined);
    emitWidgetEvent("widgetOpened", undefined);
    emitWidgetEvent("feedbackSubmitted", {
      boardId: "b1",
      boardName: "Roadmap",
      title: "Test",
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it("unsubscribe(*) removes the listener", () => {
    const callback = vi.fn();
    subscribe("*", callback);
    unsubscribe("*", callback);

    emitWidgetEvent("widgetReady", undefined);
    expect(callback).not.toHaveBeenCalled();
  });
});

describe("emitWidgetEvent", () => {
  it("dispatches a CustomEvent on window with correct detail shape", () => {
    const handler = vi.fn();
    window.addEventListener("widgetReady", handler);

    emitWidgetEvent("widgetReady", undefined);

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]?.[0] as CustomEvent<FeebloEventDetail>;
    expect(event.detail.type).toBe("widgetReady");
    expect(event.detail.namespace).toBe("feeblo");
    expect(event.detail.data).toBeUndefined();

    window.removeEventListener("widgetReady", handler);
  });
});
