import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TriggerTarget } from "../src/triggers";
import {
  bindTriggers,
  extractTriggerMetadata,
  startTriggerScanning,
  stopTriggerScanning,
} from "../src/triggers";

describe("extractTriggerMetadata", () => {
  it("extracts board metadata from data-feeblo-board attribute", () => {
    const el = document.createElement("button");
    el.setAttribute("data-feeblo-feedback", "");
    el.setAttribute("data-feeblo-board", "roadmap");

    const metadata = extractTriggerMetadata(el);

    expect(metadata).toEqual({ board: "roadmap" });
  });

  it("converts dataset keys from PascalCase to camelCase metadata", () => {
    const el = document.createElement("button");
    el.setAttribute("data-feeblo-feedback", "");
    el.setAttribute("data-feeblo-custom-key", "value1");
    el.setAttribute("data-feeblo-another-field", "value2");

    const metadata = extractTriggerMetadata(el);

    // Dataset keys become camelCase: feebloCustomKey -> customKey
    expect(metadata).toHaveProperty("customKey", "value1");
    expect(metadata).toHaveProperty("anotherField", "value2");
  });

  it("ignores non-feeblo data attributes", () => {
    const el = document.createElement("button");
    el.setAttribute("data-feeblo-feedback", "");
    el.setAttribute("data-feeblo-board", "changelog");
    el.setAttribute("data-other", "ignored");
    el.setAttribute("data-test", "also-ignored");

    const metadata = extractTriggerMetadata(el);

    expect(metadata).toEqual({ board: "changelog" });
  });

  it("returns empty object when no feeblo metadata attributes exist", () => {
    const el = document.createElement("button");
    el.setAttribute("data-feeblo-feedback", "");

    const metadata = extractTriggerMetadata(el);

    expect(metadata).toEqual({});
  });

  it("excludes the feedback selector attribute even when it has a value", () => {
    const el = document.createElement("button");
    el.setAttribute("data-feeblo-feedback", "true");
    el.setAttribute("data-feeblo-board", "roadmap");

    const metadata = extractTriggerMetadata(el);

    expect(metadata).toEqual({ board: "roadmap" });
  });
});

describe("bindTriggers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("binds click handlers to elements with data-feeblo-feedback", () => {
    const button = document.createElement("button");
    button.setAttribute("data-feeblo-feedback", "");
    document.body.appendChild(button);

    const target: TriggerTarget = {
      open: vi.fn(),
      setBoard: vi.fn(),
    };

    bindTriggers(target);

    button.click();

    expect(target.open).toHaveBeenCalledTimes(1);
    const [triggerArg] = target.open.mock.calls[0]!;
    expect(triggerArg).toBe(button);
  });

  it("sets board before opening when data-feeblo-board is present", () => {
    const button = document.createElement("button");
    button.setAttribute("data-feeblo-feedback", "");
    button.setAttribute("data-feeblo-board", "roadmap");
    document.body.appendChild(button);

    const target: TriggerTarget = {
      open: vi.fn(),
      setBoard: vi.fn(),
    };

    bindTriggers(target);

    button.click();

    expect(target.setBoard).toHaveBeenCalledWith("roadmap");
    expect(target.open).toHaveBeenCalledTimes(1);
  });

  it("marks bound triggers to avoid double-binding", () => {
    const button = document.createElement("button");
    button.setAttribute("data-feeblo-feedback", "");
    document.body.appendChild(button);

    const target: TriggerTarget = {
      open: vi.fn(),
      setBoard: vi.fn(),
    };

    bindTriggers(target);
    bindTriggers(target);

    button.click();

    expect(target.open).toHaveBeenCalledTimes(1);
    expect(button.dataset.feebloBound).toBe("true");
  });

  it("passes trigger metadata through the open call", () => {
    const button = document.createElement("button");
    button.setAttribute("data-feeblo-feedback", "");
    button.setAttribute("data-feeblo-board", "changelog");
    button.setAttribute("data-feeblo-custom-field", "abc");
    document.body.appendChild(button);

    const target: TriggerTarget = {
      open: vi.fn(),
      setBoard: vi.fn(),
    };

    bindTriggers(target);

    button.click();

    const [, metadata] = target.open.mock.calls[0]!;
    expect(metadata.board).toBe("changelog");
    expect(metadata.customField).toBe("abc");
  });
});

describe("startTriggerScanning / stopTriggerScanning", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopTriggerScanning();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("binds triggers immediately and on interval", () => {
    const button = document.createElement("button");
    button.setAttribute("data-feeblo-feedback", "");
    document.body.appendChild(button);

    const target: TriggerTarget = {
      open: vi.fn(),
      setBoard: vi.fn(),
    };

    startTriggerScanning(target);

    // Immediately bound
    expect(button.dataset.feebloBound).toBe("true");

    // Add a new trigger element after the initial scan
    const button2 = document.createElement("button");
    button2.setAttribute("data-feeblo-feedback", "");
    document.body.appendChild(button2);

    // It shouldn't be bound yet
    expect(button2.dataset.feebloBound).toBeUndefined();

    // Advance the interval timer
    vi.advanceTimersByTime(1000);

    // Now it should be bound
    expect(button2.dataset.feebloBound).toBe("true");
  });

  it("does not start a second scan loop", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    setIntervalSpy.mockClear();

    const target: TriggerTarget = {
      open: vi.fn(),
      setBoard: vi.fn(),
    };

    startTriggerScanning(target);
    startTriggerScanning(target);

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    setIntervalSpy.mockRestore();
  });

  it("stopTriggerScanning clears the interval", () => {
    const target: TriggerTarget = {
      open: vi.fn(),
      setBoard: vi.fn(),
    };

    startTriggerScanning(target);
    stopTriggerScanning();

    // Add a new element
    const button = document.createElement("button");
    button.setAttribute("data-feeblo-feedback", "");
    document.body.appendChild(button);

    // Advance time
    vi.advanceTimersByTime(2000);

    // Should not be bound since scanning stopped
    expect(button.dataset.feebloBound).toBeUndefined();
  });
});
