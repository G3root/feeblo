import { expect, type Page, test } from "@playwright/test";
import { createAuthenticatedWorkspace } from "../helpers/auth";

function customAttributesUrl(organizationUrl: string): string {
  return `${organizationUrl}/settings/custom-attributes`;
}

function contactUrl(organizationUrl: string): string {
  return `${organizationUrl}/contact`;
}

function companyUrl(organizationUrl: string): string {
  return `${organizationUrl}/company`;
}

function attributeRow(page: Page, name: string) {
  return page.getByRole("row").filter({
    has: page.getByRole("cell", { name, exact: true }),
  });
}

test.describe("custom attributes", () => {
  test("owner can create, update, and delete a contact attribute", async ({
    page,
  }) => {
    const owner = await createAuthenticatedWorkspace(page);
    const initialName = "Customer tier";
    const updatedName = "Customer segment";

    await page.goto(customAttributesUrl(owner.organizationUrl));

    await page
      .getByLabel("Contacts")
      .getByRole("button", { name: "New attribute" })
      .click();
    const createDialog = page.getByRole("dialog", {
      name: "Create contact attribute",
    });
    await createDialog.getByRole("textbox", { name: "Name" }).fill(initialName);
    await createDialog.getByRole("switch", { name: "Required" }).click();
    await createDialog
      .getByRole("button", { name: "Create attribute" })
      .click();

    await expect(
      page.getByText("Contact attribute created", { exact: true })
    ).toBeVisible();
    const createdRow = attributeRow(page, initialName);
    await expect(createdRow).toContainText("customerTier");
    await expect(createdRow).toContainText("Text");
    await expect(createdRow).toContainText("Required");

    await createdRow
      .getByRole("button", { name: `Open actions for ${initialName}` })
      .click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const editDialog = page.getByRole("dialog", {
      name: "Edit contact attribute",
    });
    await editDialog.getByRole("textbox", { name: "Name" }).fill(updatedName);
    await editDialog.getByRole("switch", { name: "Required" }).click();
    await editDialog.getByRole("button", { name: "Save changes" }).click();

    await expect(
      page.getByText("Attribute updated successfully", { exact: true })
    ).toBeVisible();
    const updatedRow = attributeRow(page, updatedName);
    await expect(updatedRow).toContainText("customerSegment");
    await expect(updatedRow).toContainText("Optional");

    await updatedRow
      .getByRole("button", { name: `Open actions for ${updatedName}` })
      .click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const deleteDialog = page.getByRole("alertdialog", {
      name: "Delete Attribute",
    });
    await deleteDialog.getByRole("button", { name: "Continue" }).click();

    await expect(
      page.getByText("Attribute deleted successfully", { exact: true })
    ).toBeVisible();
    await expect(attributeRow(page, updatedName)).toHaveCount(0);
  });

  test("owner can create, update, and delete a company attribute", async ({
    page,
  }) => {
    const owner = await createAuthenticatedWorkspace(page);
    const initialName = "Industry";
    const updatedName = "Market segment";

    await page.goto(customAttributesUrl(owner.organizationUrl));
    await page.getByRole("tab", { name: "Companies" }).click();

    await page
      .getByLabel("Companies")
      .getByRole("button", { name: "New attribute" })
      .click();
    const createDialog = page.getByRole("dialog", {
      name: "Create company attribute",
    });
    await createDialog.getByRole("textbox", { name: "Name" }).fill(initialName);
    await createDialog.getByRole("switch", { name: "Required" }).click();
    await createDialog
      .getByRole("button", { name: "Create attribute" })
      .click();

    await expect(
      page.getByText("Company attribute created", { exact: true })
    ).toBeVisible();
    const createdRow = attributeRow(page, initialName);
    await expect(createdRow).toContainText("industry");
    await expect(createdRow).toContainText("Required");

    await createdRow
      .getByRole("button", { name: `Open actions for ${initialName}` })
      .click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const editDialog = page.getByRole("dialog", {
      name: "Edit company attribute",
    });
    await editDialog.getByRole("textbox", { name: "Name" }).fill(updatedName);
    await editDialog.getByRole("switch", { name: "Required" }).click();
    await editDialog.getByRole("button", { name: "Save changes" }).click();

    await expect(
      page.getByText("Attribute updated successfully", { exact: true })
    ).toBeVisible();
    const updatedRow = attributeRow(page, updatedName);
    await expect(updatedRow).toContainText("marketSegment");
    await expect(updatedRow).toContainText("Optional");

    await updatedRow
      .getByRole("button", { name: `Open actions for ${updatedName}` })
      .click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page
      .getByRole("alertdialog", { name: "Delete Attribute" })
      .getByRole("button", { name: "Continue" })
      .click();

    await expect(
      page.getByText("Attribute deleted successfully", { exact: true })
    ).toBeVisible();
    await expect(attributeRow(page, updatedName)).toHaveCount(0);
  });

  test("owner can create a contact with a custom attribute value", async ({
    page,
  }) => {
    const owner = await createAuthenticatedWorkspace(page);
    const attributeName = "Lifecycle stage";
    const contactName = "Ada Lovelace";
    const contactEmail = "ada@example.com";

    await page.goto(customAttributesUrl(owner.organizationUrl));
    await page
      .getByLabel("Contacts")
      .getByRole("button", { name: "New attribute" })
      .click();
    const attributeDialog = page.getByRole("dialog", {
      name: "Create contact attribute",
    });
    await attributeDialog
      .getByRole("textbox", { name: "Name" })
      .fill(attributeName);
    await attributeDialog
      .getByRole("button", { name: "Create attribute" })
      .click();
    await expect(
      page.getByText("Contact attribute created", { exact: true })
    ).toBeVisible();

    await page.goto(contactUrl(owner.organizationUrl));
    await page.getByRole("button", { name: "Create contact" }).click();
    const contactDialog = page.getByRole("dialog", { name: "Create contact" });
    await contactDialog.getByRole("textbox", { name: "Name" }).fill(contactName);
    await contactDialog
      .getByRole("textbox", { name: "Email" })
      .fill(contactEmail);
    await contactDialog
      .getByRole("textbox", { name: attributeName })
      .fill("Qualified");
    await contactDialog.getByRole("button", { name: "Create contact" }).click();

    await expect(
      page.getByText("Contact created", { exact: true })
    ).toBeVisible();
    const contactRow = attributeRow(page, contactName);
    await expect(contactRow).toContainText(contactEmail);
    await expect(contactRow).toContainText("Qualified");
  });

  test("owner can create a company with a custom attribute value", async ({
    page,
  }) => {
    const owner = await createAuthenticatedWorkspace(page);
    const attributeName = "Industry";
    const companyName = "Analytical Engines";

    await page.goto(customAttributesUrl(owner.organizationUrl));
    await page.getByRole("tab", { name: "Companies" }).click();
    await page
      .getByLabel("Companies")
      .getByRole("button", { name: "New attribute" })
      .click();
    const attributeDialog = page.getByRole("dialog", {
      name: "Create company attribute",
    });
    await attributeDialog
      .getByRole("textbox", { name: "Name" })
      .fill(attributeName);
    await attributeDialog.getByRole("switch", { name: "Required" }).click();
    await attributeDialog
      .getByRole("button", { name: "Create attribute" })
      .click();
    await expect(
      page.getByText("Company attribute created", { exact: true })
    ).toBeVisible();

    await page.goto(companyUrl(owner.organizationUrl));
    await page.getByRole("button", { name: "Create company" }).click();
    const companyDialog = page.getByRole("dialog", { name: "Create company" });
    await companyDialog.getByRole("textbox", { name: "Name" }).fill(companyName);
    await companyDialog
      .getByRole("textbox", { name: attributeName })
      .fill("Computing");
    await companyDialog.getByRole("button", { name: "Create company" }).click();

    await expect(
      page.getByText("Company created", { exact: true })
    ).toBeVisible();
    await expect(attributeRow(page, companyName)).toContainText("Computing");
  });
});
