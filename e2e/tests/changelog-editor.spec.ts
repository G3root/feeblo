import { randomUUID } from "node:crypto";

import { expect, test } from "../fixtures";
import { createAuthenticatedWorkspace } from "../helpers/auth";
import {
  createChangelogDraft,
  openChangelogEntry,
  publishOpenChangelogEntry,
} from "../helpers/changelog";
import { createTestUser } from "../helpers/test-users";

test.describe("changelog editor", () => {
  test("publishing under a new slug keeps the editor on screen", async ({
    page,
  }) => {
    const user = createTestUser();
    const workspace = await createAuthenticatedWorkspace(page, user);
    await expect(page).toHaveURL(workspace.organizationUrl);

    const title = `Renamed changelog ${randomUUID().slice(0, 8)}`;
    const slug = `renamed-${randomUUID().slice(0, 8)}`;

    await createChangelogDraft(page, title, "Body of the renamed entry.");
    await openChangelogEntry(page, title);
    await expect(page.getByLabel("Post Title")).toHaveValue(title);

    // A save writes the new slug into the collection and only then navigates to
    // it, so the URL names a slug no row answers for the length of the save
    // round trip. The editor has to keep the row it was already showing;
    // dropping back to the route's empty state unmounts the whole page — the
    // content editor, the sidebar, everything — and remounts it once the URL
    // catches up, which reads as a flash. Only this route renders an
    // `empty-title` on the page, so watching for one covers both of its empty
    // states ("Changelog not found" and "Changelog unavailable"). The observer
    // records its finding on the document element, which survives the
    // client-side navigation the publish ends with.
    await page.evaluate(() => {
      const check = () => {
        if (document.querySelector('[data-slot="empty-title"]') !== null) {
          document.documentElement.dataset.changelogEditorEmptyState = "seen";
        }
      };
      check();
      new MutationObserver(check).observe(document.body, {
        childList: true,
        subtree: true,
      });
    });

    await publishOpenChangelogEntry(page, slug);
    await expect(page).toHaveURL(new RegExp(`/changelog/edit/${slug}$`));

    await expect(page.locator("html")).not.toHaveAttribute(
      "data-changelog-editor-empty-state",
      "seen"
    );
    await expect(page.getByLabel("Post Title")).toHaveValue(title);
  });
});
