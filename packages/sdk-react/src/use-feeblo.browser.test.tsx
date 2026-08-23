import { Feeblo } from "@feeblo/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useFeeblo } from "./context";
import {
  ErrorCatcher,
  interceptIframePostMessages,
  postFromWidget,
} from "./test-helpers";
import { StateProbe, TestProvider } from "./test-probes";

function BrokenProbe(): null {
  useFeeblo();
  return null;
}

describe("useFeeblo", () => {
  afterEach(() => {
    Feeblo.destroy();
  });

  it("throws a helpful error outside of a FeebloProvider", async () => {
    const screen = await render(
      <ErrorCatcher>
        <BrokenProbe />
      </ErrorCatcher>
    );

    await expect.element(screen.getByText(/must be used inside/)).toBeVisible();
  });

  it("opens and closes optimistically", async () => {
    const screen = await render(
      <TestProvider organizationId="org_toggle">
        <StateProbe />
      </TestProvider>
    );

    await expect.element(screen.getByText("open:no")).toBeVisible();

    await screen.getByRole("button", { name: "open" }).click();
    await expect.element(screen.getByText("open:yes")).toBeVisible();

    // The click also lands outside the embed container while the widget is
    // open; the embed's own outside-click handling must not fight the
    // explicit close.
    await screen.getByRole("button", { name: "close" }).click();
    await expect.element(screen.getByText("open:no")).toBeVisible();
  });

  it("closes reactively when the widget closes itself", async () => {
    const screen = await render(
      <TestProvider organizationId="org_reactive">
        <StateProbe />
      </TestProvider>
    );

    await screen.getByRole("button", { name: "open" }).click();
    await expect.element(screen.getByText("open:yes")).toBeVisible();

    // The widget can close itself (ESC key, outside click, CLOSE message);
    // the provider must mirror that without any host-side call.
    postFromWidget({ event: "CLOSE" });

    await expect.element(screen.getByText("open:no")).toBeVisible();
  });

  it("sends SET_BOARD for the active board", async () => {
    const screen = await render(
      <TestProvider organizationId="org_board">
        <StateProbe />
      </TestProvider>
    );
    postFromWidget({ event: "READY" });
    const sent = interceptIframePostMessages();

    await screen.getByRole("button", { name: "board" }).click();

    await vi.waitFor(() => {
      const setBoard = sent.find((message) => message.event === "SET_BOARD");
      expect(setBoard?.data).toMatchObject({ board: "roadmap" });
    });
  });

  it("sends SET_CONTEXT patches from metadata", async () => {
    const screen = await render(
      <TestProvider organizationId="org_metadata">
        <StateProbe />
      </TestProvider>
    );
    postFromWidget({ event: "READY" });
    const sent = interceptIframePostMessages();

    await screen.getByRole("button", { name: "metadata" }).click();

    await vi.waitFor(() => {
      const setContext = sent.find(
        (message) => message.event === "SET_CONTEXT"
      );
      expect(setContext?.data).toMatchObject({ plan: "pro" });
    });
  });

  it("sends IDENTIFY from the identify action", async () => {
    const screen = await render(
      <TestProvider organizationId="org_identify">
        <StateProbe />
      </TestProvider>
    );
    postFromWidget({ event: "READY" });
    const sent = interceptIframePostMessages();

    await screen.getByRole("button", { name: "identify" }).click();

    await vi.waitFor(() => {
      const identify = sent.find((message) => message.event === "IDENTIFY");
      expect(identify?.data).toMatchObject({ id: "u_probe" });
    });
  });

  it("switches hub modules and opens the widget", async () => {
    const screen = await render(
      <TestProvider
        mode="hub"
        modules={["updates", "feedback"]}
        organizationId="org_hub"
      >
        <StateProbe />
      </TestProvider>
    );
    postFromWidget({ event: "READY" });
    const sent = interceptIframePostMessages();

    await screen.getByRole("button", { name: "module" }).click();

    await vi.waitFor(() => {
      const setModule = sent.find((message) => message.event === "SET_MODULE");
      expect(setModule?.data).toMatchObject({ module: "updates" });
    });
    expect(sent.some((message) => message.event === "SHOW")).toBe(true);
    await expect.element(screen.getByText("open:yes")).toBeVisible();
  });
});
