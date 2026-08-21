import { Feeblo } from "@feeblo/sdk";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { interceptIframePostMessages, postFromWidget } from "./test-helpers";
import { StateProbe, TestProvider } from "./test-probes";

describe("FeebloProvider", () => {
  afterEach(() => {
    Feeblo.destroy();
  });

  it("mounts the widget container and removes it on unmount", async () => {
    const screen = await render(
      <TestProvider organizationId="org_mount">
        <StateProbe />
      </TestProvider>
    );

    const container = document.getElementById("feeblo-embed-container");
    expect(container).not.toBeNull();
    // The test containerStyles override reaches the embed.
    expect(container?.style.width).toBe("2px");

    screen.unmount();
    expect(document.getElementById("feeblo-embed-container")).toBeNull();
  });

  it("becomes ready when the widget reports READY", async () => {
    const screen = await render(
      <TestProvider organizationId="org_ready">
        <StateProbe />
      </TestProvider>
    );

    await expect.element(screen.getByText("ready:no")).toBeVisible();

    postFromWidget({ event: "READY" });

    await expect.element(screen.getByText("ready:yes")).toBeVisible();
  });

  it("becomes ready when the iframe finishes loading", async () => {
    const screen = await render(
      <TestProvider organizationId="org_natural_ready">
        <StateProbe />
      </TestProvider>
    );

    // The iframe loads a same-origin page from the test server; its load
    // event marks the embed ready without any replayed message.
    await expect
      .element(screen.getByText("ready:yes"), { timeout: 15_000 })
      .toBeVisible();
  });

  it("forwards widget errors to onError", async () => {
    const onError = vi.fn();
    await render(
      <TestProvider onError={onError} organizationId="org_errors">
        <StateProbe />
      </TestProvider>
    );

    postFromWidget({
      data: { code: "INVALID_TOKEN", message: "bad token" },
      event: "ERROR",
    });

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });
    const error = onError.mock.calls[0]?.[0];
    expect(error?.code).toBe("INVALID_TOKEN");
    expect(error?.message).toBe("bad token");
  });

  it("forwards page height updates to onHeightChange", async () => {
    const onHeightChange = vi.fn();
    await render(
      <TestProvider onHeightChange={onHeightChange} organizationId="org_height">
        <StateProbe />
      </TestProvider>
    );

    postFromWidget({ data: { height: 240 }, event: "PAGE_HEIGHT" });

    await vi.waitFor(() => {
      expect(onHeightChange).toHaveBeenCalledWith(240);
    });
  });

  it("calls onClose when the widget closes itself", async () => {
    const onClose = vi.fn();
    const screen = await render(
      <TestProvider onClose={onClose} organizationId="org_self_close">
        <StateProbe />
      </TestProvider>
    );

    await screen.getByRole("button", { name: "open" }).click();
    await expect.element(screen.getByText("open:yes")).toBeVisible();

    postFromWidget({ event: "CLOSE" });

    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    await expect.element(screen.getByText("open:no")).toBeVisible();
  });

  it("re-initializes the embed when config props change", async () => {
    const screen = await render(
      <TestProvider organizationId="org_reconfig" theme="dark">
        <StateProbe />
      </TestProvider>
    );
    const firstIframe = document.querySelector("iframe");
    expect(firstIframe?.src).toContain("theme=dark");

    postFromWidget({ event: "READY" });
    await expect.element(screen.getByText("ready:yes")).toBeVisible();

    await screen.rerender(
      <TestProvider organizationId="org_reconfig" theme="light">
        <StateProbe />
      </TestProvider>
    );

    const secondIframe = document.querySelector("iframe");
    expect(secondIframe).not.toBe(firstIframe);
    expect(secondIframe?.src).toContain("theme=light");

    // Readiness resets with the recreated embed until it reports READY again.
    await expect.element(screen.getByText("ready:no")).toBeVisible();
    postFromWidget({ event: "READY" });
    await expect.element(screen.getByText("ready:yes")).toBeVisible();
  });

  it("re-initializes onto the new element when the root prop changes", async () => {
    const firstRoot = document.createElement("div");
    const secondRoot = document.createElement("div");
    document.body.append(firstRoot, secondRoot);

    try {
      const screen = await render(
        <TestProvider organizationId="org_root" root={firstRoot}>
          <StateProbe />
        </TestProvider>
      );
      const firstContainer = document.getElementById("feeblo-embed-container");
      expect(firstContainer?.parentElement).toBe(firstRoot);

      await screen.rerender(
        <TestProvider organizationId="org_root" root={secondRoot}>
          <StateProbe />
        </TestProvider>
      );

      // A different root element must destroy the old embed and mount a
      // fresh one inside the new root; DOM elements serialize identically,
      // so this transition is invisible to the serialized config key.
      const nextContainer = document.getElementById("feeblo-embed-container");
      expect(nextContainer).not.toBe(firstContainer);
      expect(nextContainer?.parentElement).toBe(secondRoot);
    } finally {
      firstRoot.remove();
      secondRoot.remove();
    }
  });

  it("re-identifies without recreating the embed when user changes", async () => {
    const screen = await render(
      <TestProvider
        organizationId="org_identity"
        user={{ email: "before@example.com", id: "u_1" }}
      >
        <StateProbe />
      </TestProvider>
    );
    postFromWidget({ event: "READY" });

    const firstIframe = document.querySelector("iframe");
    const sent = interceptIframePostMessages();
    await screen.rerender(
      <TestProvider
        organizationId="org_identity"
        user={{ email: "after@example.com", id: "u_2" }}
      >
        <StateProbe />
      </TestProvider>
    );

    await vi.waitFor(() => {
      const identify = sent.find((message) => message.event === "IDENTIFY");
      expect(identify?.data).toMatchObject({ id: "u_2" });
    });
    // The iframe was reused, not recreated.
    expect(document.querySelector("iframe")).toBe(firstIframe);
  });

  it("survives StrictMode double-mounting with a single embed", async () => {
    const screen = await render(
      <StrictMode>
        <TestProvider organizationId="org_strict">
          <StateProbe />
        </TestProvider>
      </StrictMode>
    );

    const containers = document.querySelectorAll("#feeblo-embed-container");
    expect(containers.length).toBe(1);

    postFromWidget({ event: "READY" });
    await expect.element(screen.getByText("ready:yes")).toBeVisible();

    screen.unmount();
    expect(document.getElementById("feeblo-embed-container")).toBeNull();
  });
});
