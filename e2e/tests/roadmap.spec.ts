import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { createAuthenticatedWorkspace } from "../helpers/auth";
import { organizationIdFromUrl, seedRoadmap } from "../helpers/seed-roadmap";
import { createTestUser } from "../helpers/test-users";

const roadmapUrlPattern = /\/roadmap$/;
const publicPostUrlPattern = /\/p\//;
const roadmapSwitcherUrlPattern = /\/roadmap\/q3-focus$/;

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
      const workspace = await createAuthenticatedWorkspace(
        page,
        createTestUser()
      );
      const title = `Roadmap post ${randomUUID().slice(0, 8)}`;
      await createPost(page, title, "This post should start in Planned.");

      // Posts created from the dashboard default to the Pending status. The
      // roadmap only configures Planned/In progress/Completed columns, so the
      // post stays off the roadmap instead of surfacing as an extra lane.
      await page.goto(`${workspace.organizationUrl}/roadmap`);
      await expect(page).toHaveURL(roadmapUrlPattern);
      await expect(
        page.getByRole("heading", { name: "Roadmap", exact: true })
      ).toBeVisible();
      for (const laneName of ["Planned", "In progress", "Completed"]) {
        await expect(
          page.getByRole("heading", { name: laneName, exact: true })
        ).toBeVisible();
      }
      await expect(
        roadmapLane(page, "Planned").getByText("No issues in this stage.")
      ).toBeVisible();
      await expect(page.getByText(title)).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "Pending", exact: true })
      ).toHaveCount(0);

      // Move the post to Planned so it lands in the matching lane.
      await page.goto(workspace.organizationUrl);
      await page.getByText(title).click();
      await expect(page.getByLabel("Post Title")).toHaveValue(title);
      await page.getByRole("combobox").first().click();
      await page.getByRole("option", { name: "Planned", exact: true }).click();
      await expect(page.getByText("Status updated")).toBeVisible();

      await page.goto(`${workspace.organizationUrl}/roadmap`);
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

      // Move the post to Planned so it shows up in a configured lane.
      await page.getByText(title).click();
      await expect(page.getByLabel("Post Title")).toHaveValue(title);
      await page.getByRole("combobox").first().click();
      await page.getByRole("option", { name: "Planned", exact: true }).click();
      await expect(page.getByText("Status updated")).toBeVisible();

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

        const plannedLane = roadmapLane(visitorPage, "Planned");
        await expect(plannedLane.getByText(title)).toBeVisible();
        await expect(plannedLane.getByText("Features 💡")).toBeVisible();
        // Unconfigured statuses do not surface as extra lanes.
        await expect(
          visitorPage.getByRole("heading", { name: "Pending", exact: true })
        ).toHaveCount(0);
        await expect(
          roadmapLane(visitorPage, "In progress").getByText(
            "No updates in this stage."
          )
        ).toBeVisible();

        await plannedLane.getByText(title).click();
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
      await page.getByText(title).click();
      await expect(page.getByLabel("Post Title")).toHaveValue(title);
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
        const roadmapSwitcher = visitorPage.getByRole("combobox");
        await expect(
          visitorPage.getByRole("heading", { name: "Roadmap", exact: true })
        ).toBeVisible();
        await expect(
          visitorPage.getByRole("heading", { name: "In progress", exact: true })
        ).toBeVisible();
        await expect(
          roadmapLane(visitorPage, "Planned").getByText(title)
        ).toBeVisible();

        // Switching roadmaps swaps the board to the seeded roadmap's columns.
        await roadmapSwitcher.click();
        await visitorPage
          .getByRole("option", { name: "Q3 Focus", exact: true })
          .click();
        await expect(visitorPage).toHaveURL(roadmapSwitcherUrlPattern);
        await expect(
          visitorPage.getByRole("heading", { name: "Q3 Focus", exact: true })
        ).toBeVisible();
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
          `${publicBoardUrl(user.workspaceName)}/roadmap/q3-focus`
        );
        await expect(
          visitorPage.getByRole("heading", { name: "Q3 Focus", exact: true })
        ).toBeVisible();
        await expect(
          visitorPage.getByRole("heading", { name: "Shipped", exact: true })
        ).toBeVisible();

        // Unknown slugs render the unavailable state.
        await visitorPage.goto(
          `${publicBoardUrl(user.workspaceName)}/roadmap/does-not-exist`
        );
        await expect(
          visitorPage.getByText(
            "This roadmap does not exist or has been removed.",
            { exact: true }
          )
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

      // The first toast lingers for a few seconds. If we toggle the switch
      // again while it is still on screen, the assertion below would match the
      // OLD toast (identical text) and pass before the second SiteUpdate write
      // has actually persisted — then the visitor reload below could capture
      // the still-stale HIDDEN visibility. Wait for the first toast to dismiss
      // so the next assertion can only match the second toggle's toast, which
      // is added only after its write completes.
      await expect(
        page.getByText("Roadmap visibility updated", { exact: true })
      ).toBeHidden();

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
