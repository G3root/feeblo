import { expect, test } from "../fixtures";
import { signUpProgrammatically } from "../helpers/auth";
import { createTestUser, subdomainFor } from "../helpers/test-users";
import { RegisterPage } from "../page-objects/RegisterPage";

/**
 * The first-workspace welcome tour.
 *
 * Deliberately does not use `createWorkspace`: that helper dismisses the tour,
 * because every other spec wants a dashboard it can click on. Here the tour is
 * the thing under test, so the registration is driven directly.
 */
test.describe("welcome tour", () => {
  test("a first workspace opens with sample posts and a tour, once", async ({
    page,
  }) => {
    const user = createTestUser();
    await signUpProgrammatically(page, user);

    const registerPage = new RegisterPage(page);
    await registerPage.goto();
    await Promise.all([
      page.waitForURL(/\/org_/),
      registerPage.createWorkspace(
        user.workspaceName,
        subdomainFor(user.workspaceName)
      ),
    ]);

    const tour = page.getByRole("dialog");
    await expect(tour).toBeVisible();
    await expect(
      tour.getByRole("heading", { name: `Welcome to ${user.workspaceName}` })
    ).toBeVisible();

    // The seeded sample posts are real posts on the dashboard, not a separate
    // onboarding surface: the tour only makes sense if they are there.
    await expect(
      page.getByText("Welcome to your workspace").first()
    ).toBeVisible();

    for (let step = 1; step < 5; step += 1) {
      await tour.getByRole("button", { name: "Continue" }).click();
    }

    await tour.getByRole("button", { name: "Get started" }).click();
    await expect(tour).toBeHidden();

    // The completion is remembered per workspace, so a reload does not greet
    // the same reader twice.
    await page.reload();
    await expect(page.getByRole("dialog")).toBeHidden();
  });
});
