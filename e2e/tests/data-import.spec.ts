import { expect, type Page, test } from "../fixtures";
import { createAuthenticatedWorkspace } from "../helpers/auth";

const CSV_HEADER =
  "title,content,status,board,tags,eta,author_name,author_email,created_at";

const importCsv = (rows: readonly string[]): string =>
  [CSV_HEADER, ...rows].join("\n");

const dataSettingsUrl = (organizationUrl: string): string =>
  `${organizationUrl}/settings/data`;

async function uploadCsv(page: Page, name: string, contents: string) {
  await page.getByLabel("CSV file").setInputFiles({
    buffer: Buffer.from(contents),
    mimeType: "text/csv",
    name,
  });
  await page.getByRole("button", { name: "Upload and preview" }).click();
}

test.describe("data import", () => {
  test("reviews a staged import and confirms it into a post", async ({
    page,
  }) => {
    const owner = await createAuthenticatedWorkspace(page);
    await page.goto(dataSettingsUrl(owner.organizationUrl));

    await uploadCsv(
      page,
      "posts.csv",
      importCsv(["Imported post,Body,,,,,,,,", ",No title,,,,,,,,"])
    );

    // A staged import is never confirmed from the settings page: the banner
    // and the card both lead to the review, and only the review writes.
    await expect(
      page.getByText("An import is waiting for confirmation")
    ).toBeVisible();
    await page.getByRole("link", { name: "Review import" }).first().click();
    await expect(page).toHaveURL(/\/settings\/data\/imports\//);

    // The review shows the failed row and the substitutions before anything
    // is written.
    await expect(page.getByText("Failure reasons")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Download errors (CSV)" })
    ).toBeVisible();
    await expect(
      page.getByText("The title is required.").first()
    ).toBeVisible();
    await expect(page.getByText("Ready", { exact: true })).toBeVisible();

    // A failure group narrows the table to the rows it counts.
    await page.getByRole("link", { name: "Failed 1" }).click();
    await expect(page).toHaveURL(/filter=failed/);
    await expect(page.getByText("Rows 1-1 of 1")).toBeVisible();

    // Confirming names what is about to happen.
    await page.getByRole("button", { name: "Import 1 posts" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByText("1 posts will be created.")).toBeVisible();
    await dialog.getByRole("button", { name: "Import 1 posts" }).click();

    // The watch stream reports the run and its end without a reload.
    await expect(
      page.locator('[data-slot="badge"]').filter({ hasText: "Completed" })
    ).toBeVisible({ timeout: 30_000 });

    // Leave the failed-only view and confirm the created row links to the post.
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(
      page.getByText("Imported", { exact: true }).first()
    ).toBeVisible();
    await page.getByRole("link", { name: "View post" }).click();
    await expect(page).toHaveURL(/\/post\/.+\/imported-post/);
    await expect(page.getByRole("textbox", { name: "Post Title" })).toHaveValue(
      "Imported post"
    );
  });

  test("refuses a file that is not a CSV before uploading it", async ({
    page,
  }) => {
    const owner = await createAuthenticatedWorkspace(page);
    await page.goto(dataSettingsUrl(owner.organizationUrl));

    await page.getByLabel("CSV file").setInputFiles({
      buffer: Buffer.from("not a csv"),
      mimeType: "text/plain",
      name: "notes.txt",
    });

    await expect(page.getByText("Choose a CSV file.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Upload and preview" })
    ).toBeDisabled();
  });

  test("cancels a staged import so the next file can be uploaded", async ({
    page,
  }) => {
    const owner = await createAuthenticatedWorkspace(page);
    await page.goto(dataSettingsUrl(owner.organizationUrl));

    await uploadCsv(page, "posts.csv", importCsv(["First post,Body,,,,,,,,"]));
    await expect(
      page.getByRole("button", { name: "Cancel import" }).first()
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel import" }).first().click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByText("Cancel this import?")).toBeVisible();
    await dialog.getByRole("button", { name: "Discard rows" }).click();

    await expect(page.getByText("Canceled", { exact: true })).toBeVisible();
    await expect(page.getByLabel("CSV file")).toBeEnabled();
  });
});
