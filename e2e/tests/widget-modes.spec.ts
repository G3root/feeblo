import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3101";
const sdkBundlePath = fileURLToPath(
  new URL("../../packages/sdk/dist/feeblo-sdk.umd.cjs", import.meta.url)
);

test("Feeblo Hub moves between updates and feedback inside one placed widget", async ({
  page,
}) => {
  await page.route("**/api/widget/v1/boards**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "board_features",
          name: "Feature requests",
          slug: "features",
          organizationId: "org_widget_modes",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    })
  );
  await page.route("**/api/widget/v1/updates**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "update_editor",
          title: "A faster feedback editor",
          slug: "faster-feedback-editor",
          content:
            "<p>The editor now opens instantly and keeps drafts safe.</p>",
          excerpt: "The editor now opens instantly and keeps drafts safe.",
          imageUrl: null,
          publishedAt: "2026-08-01T00:00:00.000Z",
        },
      ]),
    })
  );
  await page.route("**/api/widget/v1/feedback**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "post_widget",
        slug: "hub-feedback",
        title: "Hub feedback",
        boardId: "board_features",
        organizationId: "org_widget_modes",
        createdAt: "2026-08-03T00:00:00.000Z",
      }),
    })
  );

  // Serve a stable host page from the same origin so the widget iframe can
  // load (the dashboard would otherwise redirect this bare origin to /sign-in).
  await page.route(`${baseURL}/`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><body><h1>Host app</h1></body></html>",
    })
  );

  await page.goto(`${baseURL}/`);
  await page.addScriptTag({ path: sdkBundlePath });
  await page.evaluate(
    ({ host }) => {
      // SAFETY: the SDK bundle below registers Feeblo on the page global
      // before this evaluate step runs.
      const browserGlobal = globalThis as typeof globalThis & {
        Feeblo: {
          init: (
            organizationId: string,
            options: {
              baseUrl: string;
              mode: "hub";
              modules: ["feedback", "updates"];
              placement: "bottom-right";
            }
          ) => void;
        };
      };
      browserGlobal.Feeblo.init("org_widget_modes", {
        baseUrl: host,
        mode: "hub",
        modules: ["feedback", "updates"],
        placement: "bottom-right",
      });
    },
    { host: baseURL }
  );

  const launcher = page.getByRole("button", { name: "Open Feeblo widget" });
  await expect(launcher).toBeVisible();
  await launcher.click();

  const widget = page.frameLocator("#feeblo-embed-container iframe");
  await expect(
    widget.getByText("Give us feedback", { exact: true })
  ).toBeVisible();
  await widget.getByRole("link", { name: "Updates" }).click();
  await expect(widget.getByText("A faster feedback editor")).toBeVisible();
  await widget.getByText("A faster feedback editor").click();
  await expect(
    widget.getByText("The editor now opens instantly and keeps drafts safe.")
  ).toBeVisible();
  await widget.getByRole("button", { name: "All updates" }).click();
  await widget.getByRole("link", { name: "Feedback" }).click();

  await widget.getByRole("link", { name: "Feature requests" }).click();
  await widget
    .getByPlaceholder("Share your product feedback!")
    .fill("Hub feedback");
  await widget.getByRole("button", { name: "Create a new post" }).click();
  await expect(
    widget.getByText("Thanks for your feedback", { exact: true })
  ).toBeVisible();
});
