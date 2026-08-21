import {
  Feeblo,
  type FeebloEventDetail,
  type FeebloEventMap,
  type FeebloEventName,
} from "@feeblo/sdk";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { useFeebloEvent } from "./use-feeblo-event";

/** Emit an event exactly the way the SDK's emitWidgetEvent does. */
function emitWidgetEvent<K extends FeebloEventName>(
  type: K,
  data: FeebloEventMap[K]
): void {
  window.dispatchEvent(
    new CustomEvent<FeebloEventDetail<K>>(type, {
      detail: { data, namespace: "feeblo", type },
    })
  );
}

describe("useFeebloEvent", () => {
  afterEach(() => {
    Feeblo.destroy();
  });

  it("delivers typed event details to the handler", async () => {
    const screen = await render(<SubmittedProbe />);

    emitWidgetEvent("feedbackSubmitted", {
      boardId: "b_1",
      boardName: "Roadmap",
      title: "Dark mode",
    });

    await expect.element(screen.getByText("submitted:Dark mode")).toBeVisible();
  });

  it("observes every event through the wildcard subscription", async () => {
    const screen = await render(<WildcardProbe />);

    emitWidgetEvent("widgetReady", undefined);
    emitWidgetEvent("feedbackSubmitted", {
      boardId: "b_1",
      boardName: "Roadmap",
      title: "Dark mode",
    });

    await expect
      .element(screen.getByText("saw:widgetReady,feedbackSubmitted"))
      .toBeVisible();
  });

  it("invokes the latest handler without resubscribing", async () => {
    const screen = await render(<LatestHandlerProbe />);

    await screen.getByRole("button", { name: "version" }).click();
    await expect.element(screen.getByText("version:2")).toBeVisible();

    emitWidgetEvent("widgetReady", undefined);

    // The re-rendered closure (version 2) handled the event exactly once.
    await expect.element(screen.getByText("seen:2")).toBeVisible();
    await expect.element(screen.getByText("calls:1")).toBeVisible();
  });

  it("stops delivering after unmount", async () => {
    const received: string[] = [];

    function RecordingProbe(): null {
      useFeebloEvent("feedbackSubmitted", (event) => {
        received.push(event.detail.data?.title ?? "");
      });
      return null;
    }

    const screen = await render(<RecordingProbe />);
    screen.unmount();

    emitWidgetEvent("feedbackSubmitted", {
      boardId: "b_1",
      boardName: "Roadmap",
      title: "After unmount",
    });

    expect(received).toEqual([]);
  });

  it("resubscribes when the event name changes", async () => {
    const screen = await render(<SwitchingProbe eventName="widgetReady" />);

    emitWidgetEvent("widgetReady", undefined);
    await expect.element(screen.getByText("ready:1")).toBeVisible();

    await screen.rerender(<SwitchingProbe eventName="widgetClosed" />);
    emitWidgetEvent("widgetClosed", undefined);
    emitWidgetEvent("widgetReady", undefined);

    await expect.element(screen.getByText("closed:1")).toBeVisible();
    await expect.element(screen.getByText("ready:1")).toBeVisible();
  });
});

function SubmittedProbe(): React.JSX.Element {
  const [title, setTitle] = useState<string | null>(null);
  useFeebloEvent("feedbackSubmitted", (event) => {
    setTitle(event.detail.data?.title ?? null);
  });

  return <output>submitted:{title ?? "none"}</output>;
}

function WildcardProbe(): React.JSX.Element {
  const [seen, setSeen] = useState<string[]>([]);
  useFeebloEvent("*", (event) => {
    setSeen((previous) => [...previous, event.detail.type]);
  });

  return <output>saw:{seen.join(",")}</output>;
}

function LatestHandlerProbe(): React.JSX.Element {
  const [version, setVersion] = useState(1);
  const [calls, setCalls] = useState(0);
  const [seenVersion, setSeenVersion] = useState<number | null>(null);

  useFeebloEvent("widgetReady", () => {
    setCalls((previous) => previous + 1);
    setSeenVersion(version);
  });

  return (
    <div>
      <output>version:{version}</output>
      <output>calls:{calls}</output>
      <output>seen:{seenVersion ?? "none"}</output>
      <button onClick={() => setVersion(2)} type="button">
        version
      </button>
    </div>
  );
}

function SwitchingProbe(props: {
  eventName: FeebloEventName;
}): React.JSX.Element {
  const [readyCount, setReadyCount] = useState(0);
  const [closedCount, setClosedCount] = useState(0);

  useFeebloEvent(props.eventName, (event) => {
    if (event.detail.type === "widgetReady") {
      setReadyCount((previous) => previous + 1);
    }
    if (event.detail.type === "widgetClosed") {
      setClosedCount((previous) => previous + 1);
    }
  });

  return (
    <div>
      <output>ready:{readyCount}</output>
      <output>closed:{closedCount}</output>
    </div>
  );
}
