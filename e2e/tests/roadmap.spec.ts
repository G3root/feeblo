import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { createAuthenticatedWorkspace } from "../helpers/auth";
import { organizationIdFromUrl, seedRoadmap } from "../helpers/seed-roadmap";
import { createTestUser } from "../helpers/test-users";

const roadmapUrlPattern = /\/roadmap$/;
const publicPostUrlPattern = /\/p\//;
const roadmapSwitcherUrlPattern = /\/roadmap\?roadmap=q3-focus/;

async function createPost(page: Page, title: string, content: string) {
  await page.getByRole("button", { name: "New post" }).click();

  const dialog = page.getByRole("dialog", { name: "Create Post" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Post Title").fill(title);

  // The rich-text editor currently has no accessible name, so scope this
  // implementation-level locator to the create-post dialog only.
  const editor = dialog.locator(".ProseMirror");
  await expect(editor).toBeVisible();
  await editor.fill(content);

  await dialog.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Features 💡" }).click();
  await dialog.getByRole("button", { name: "Create Post" }).click();
  await expect(dialog).toBeHidden();
}

// Lane columns have no accessible role, so scope this implementation-level
// locator to the column wrapper through its heading.
function roadmapLane(page: Page, name: string) {
  return page
    .getByRole("heading", { name, exact: true })
    .locator("xpath=ancestor::div[contains(@class, 'w-80')][1]");
}

function publicBoardUrl(workspaceName: string) {
  const subdomain = workspaceName.toLowerCase().replaceAll(" ", "-");
  const baseURL = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3101");
  return `${baseURL.protocol}//${subdomain}.${baseURL.hostname}${baseURL.port ? `:${baseURL.port}` : ""}`;
}

test.describe("roadmap", () => {
  test(
    "posts move through dashboard roadmap lanes as their status changes",
    { tag: "@critical" },
    async ({ page }) => {
      await createAuthenticatedWorkspace(page, createTestUser());
      const title = `Roadmap post ${randomUUID().slice(0, 8)}`;
      await createPost(page, title, "This post should start in Planned.");

      await page.getByRole("link", { name: "Roadmap", exact: true }).click();
      await expect(page).toHaveURL(roadmapUrlPattern);
      await expect(
        page.getByRole("heading", { name: "Roadmap", exact: true })
      ).toBeVisible();
      for (const laneName of ["Planned", "In progress", "Completed"]) {
        await expect(
          page.getByRole("heading", { name: laneName, exact: true })
        ).toBeVisible();
      }

      // Posts created from the dashboard default to the Pending status, which
      // surfaces on the roadmap as an extra lane beyond the configured ones.
      await expect(roadmapLane(page, "Pending").getByText(title)).toBeVisible();
      await expect(
        roadmapLane(page, "Planned").getByText("No issues in this stage.")
      ).toBeVisible();

      // Open the post from its roadmap card and move it to Planned.
      await roadmapLane(page, "Pending").getByText(title).click();
      await expect(page.getByLabel("Post Title")).toHaveValue(title);
      await page.getByRole("combobox").first().click();
      await page.getByRole("option", { name: "Planned", exact: true }).click();
      await expect(page.getByText("Status updated")).toBeVisible();

      await page.getByRole("link", { name: "Roadmap", exact: true }).click();
      await expect(roadmapLane(page, "Planned").getByText(title)).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Pending", exact: true })
      ).toHaveCount(0);
    }
  );

  test(
    "visitors can browse the public roadmap and open posts",
    { tag: "@critical" },
    async ({ browser, page }) => {
      const user = createTestUser();
      await createAuthenticatedWorkspace(page, user);
      const title = `Public roadmap post ${randomUUID().slice(0, 8)}`;
      await createPost(page, title, "Visitors can follow this on the roadmap.");

      const visitorContext = await browser.newContext();
      const visitorPage = await visitorContext.newPage();

      try {
        await visitorPage.goto(publicBoardUrl(user.workspaceName));
        await visitorPage
          .getByRole("link", { name: "Roadmap", exact: true })
          .click();
        await expect(visitorPage).toHaveURL(roadmapUrlPattern);
        await expect(
          visitorPage.getByRole("heading", { name: "Roadmap", exact: true })
        ).toBeVisible();

        const pendingLane = roadmapLane(visitorPage, "Pending");
        await expect(pendingLane.getByText(title)).toBeVisible();
        await expect(pendingLane.getByText("Features 💡")).toBeVisible();
        await expect(
          roadmapLane(visitorPage, "Planned").getByText(
            "No updates in this stage."
          )
        ).toBeVisible();

        await pendingLane.getByText(title).click();
        await expect(visitorPage).toHaveURL(publicPostUrlPattern);
        await expect(visitorPage.getByText(title)).toBeVisible();
      } finally {
        await visitorContext.close();
      }
    }
  );

  test(
    "visitors can switch between multiple public roadmaps",
    { tag: "@critical" },
    async ({ browser, page }) => {
      const user = createTestUser();
      const workspace = await createAuthenticatedWorkspace(page, user);
      const organizationId = organizationIdFromUrl(workspace.organizationUrl);

      const title = `Switcher post ${randomUUID().slice(0, 8)}`;
      await createPost(page, title, "This post is planned for the quarter.");

      // Move the post to Planned so it lands in a lane that exists on both
      // roadmaps (the seeded one's "Backlog" lane points at Planned too).
      await page.getByRole("link", { name: "Roadmap", exact: true }).click();
      await roadmapLane(page, "Pending").getByText(title).click();
      await page.getByRole("combobox").first().click();
      await page.getByRole("option", { name: "Planned", exact: true }).click();
      await expect(page.getByText("Status updated")).toBeVisible();

      await seedRoadmap(page.request, {
        organizationId,
        name: "Q3 Focus",
        slug: "q3-focus",
        description: "What we are shipping this quarter.",
        columns: [
          { name: "Backlog", status: "PLANNED" },
          { name: "Shipped", status: "COMPLETED" },
        ],
      });

      const visitorContext = await browser.newContext();
      const visitorPage = await visitorContext.newPage();

      try {
        await visitorPage.goto(`${publicBoardUrl(user.workspaceName)}/roadmap`);

        // The primary roadmap is selected by default.
        await expect(
          visitorPage.getByRole("tab", { name: "Roadmap" })
        ).toHaveAttribute("aria-selected", "true");
        await expect(
          visitorPage.getByRole("tab", { name: "Q3 Focus" })
        ).toBeVisible();
        await expect(
          visitorPage.getByRole("heading", { name: "In progress", exact: true })
        ).toBeVisible();
        await expect(
          roadmapLane(visitorPage, "Planned").getByText(title)
        ).toBeVisible();

        // Switching tabs swaps the board to the seeded roadmap's columns.
        await visitorPage.getByRole("tab", { name: "Q3 Focus" }).click();
        await expect(visitorPage).toHaveURL(roadmapSwitcherUrlPattern);
        await expect(
          visitorPage.getByRole("tab", { name: "Q3 Focus" })
        ).toHaveAttribute("aria-selected", "true");
        await expect(
          visitorPage.getByText("What we are shipping this quarter.")
        ).toBeVisible();
        await expect(
          visitorPage.getByRole("heading", { name: "Backlog", exact: true })
        ).toBeVisible();
        await expect(
          visitorPage.getByRole("heading", { name: "Shipped", exact: true })
        ).toBeVisible();
        await expect(
          visitorPage.getByRole("heading", { name: "In progress", exact: true })
        ).toHaveCount(0);
        await expect(
          roadmapLane(visitorPage, "Backlog").getByText(title)
        ).toBeVisible();

        // Deep links select the requested roadmap directly.
        await visitorPage.goto(
          `${publicBoardUrl(user.workspaceName)}/roadmap?roadmap=q3-focus`
        );
        await expect(
          visitorPage.getByRole("tab", { name: "Q3 Focus" })
        ).toHaveAttribute("aria-selected", "true");
        await expect(
          visitorPage.getByRole("heading", { name: "Shipped", exact: true })
        ).toBeVisible();

        // Unknown slugs fall back to the primary roadmap.
        await visitorPage.goto(
          `${publicBoardUrl(user.workspaceName)}/roadmap?roadmap=does-not-exist`
        );
        await expect(
          visitorPage.getByRole("tab", { name: "Roadmap" })
        ).toHaveAttribute("aria-selected", "true");
        await expect(
          visitorPage.getByRole("heading", { name: "In progress", exact: true })
        ).toBeVisible();
      } finally {
        await visitorContext.close();
      }
    }
  );

  test("hiding the roadmap removes the public roadmap tab", async ({
    browser,
    page,
  }) => {
    const user = createTestUser();
    const workspace = await createAuthenticatedWorkspace(page, user);

    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();

    try {
      await visitorPage.goto(publicBoardUrl(user.workspaceName));
      await expect(
        visitorPage.getByRole("link", { name: "Roadmap", exact: true })
      ).toBeVisible();

      await page.goto(`${workspace.organizationUrl}/settings/roadmap`);
      await page.getByRole("switch").click();
      await expect(
        page.getByText("Roadmap visibility updated", { exact: true })
      ).toBeVisible();

      await visitorPage.reload();
      await expect(
        visitorPage.getByRole("link", { name: "Roadmap", exact: true })
      ).toHaveCount(0);

      await page.getByRole("switch").click();
      await expect(
        page.getByText("Roadmap visibility updated", { exact: true })
      ).toBeVisible();

      await visitorPage.reload();
      await expect(
        visitorPage.getByRole("link", { name: "Roadmap", exact: true })
      ).toBeVisible();
    } finally {
      await visitorContext.close();
    }
  });
});
