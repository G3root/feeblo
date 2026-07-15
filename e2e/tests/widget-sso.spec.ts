import { createHmac, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createAuthenticatedWorkspace } from "../helpers/auth";
import { createTestUser } from "../helpers/test-users";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3101";
const apiURL = process.env.E2E_API_URL ?? "http://localhost:3100";
const organizationIdPattern = /^org_/;
const sdkBundlePath = fileURLToPath(
  new URL("../../packages/sdk/dist/feeblo-sdk.umd.cjs", import.meta.url)
);

function signWidgetToken(
  secret: string,
  identity: { email: string; name: string; userId: string }
) {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" })
  ).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({ ...identity, iat: now, exp: now + 5 * 60 })
  ).toString("base64url");
  const unsignedToken = `${header}.${payload}`;
  const signature = createHmac("sha256", secret)
    .update(unsignedToken)
    .digest("base64url");

  return `${unsignedToken}.${signature}`;
}

function publicBoardUrl(workspaceName: string) {
  const subdomain = workspaceName.toLowerCase().replaceAll(" ", "-");
  const url = new URL(baseURL);
  return `${url.protocol}//${subdomain}.${url.hostname}${url.port ? `:${url.port}` : ""}`;
}

test(
  "identified users can submit widget feedback and sign in with SSO",
  { tag: "@critical" },
  async ({ browser, page }) => {
    const owner = createTestUser();
    const workspace = await createAuthenticatedWorkspace(page, owner);
    const organizationId = new URL(workspace.organizationUrl).pathname
      .split("/")
      .filter(Boolean)[0];

    if (!organizationId) {
      throw new Error("Workspace URL did not contain an organization id");
    }
    expect(organizationId).toMatch(organizationIdPattern);

    await test.step("copy the workspace JWT secret", async () => {
      await page
        .context()
        .grantPermissions(["clipboard-read", "clipboard-write"], {
          origin: baseURL,
        });
      await page.goto(`/${organizationId}/settings/security`);
      await page.getByRole("button", { name: "Copy Secret" }).click();
      await expect(page.getByText("Secret copied to clipboard")).toBeVisible();
    });

    const secret = await page.evaluate(() => {
      const browserNavigator = (
        globalThis as unknown as {
          navigator: { clipboard: { readText: () => Promise<string> } };
        }
      ).navigator;
      return browserNavigator.clipboard.readText();
    });
    expect(secret).toHaveLength(64);

    const visitor = {
      userId: `visitor-${randomUUID().slice(0, 12)}`,
      name: "Widget SSO Visitor",
      email: `widget-${randomUUID().slice(0, 12)}@feeblo.dev`,
    };
    const token = signWidgetToken(secret, visitor);
    const feedbackTitle = `Widget feedback ${randomUUID().slice(0, 8)}`;
    const feedbackContent =
      "Submitted from the embedded feedback widget by an identified user.";
    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();

    try {
      await test.step("submit authenticated feedback through the embedded widget", async () => {
        await visitorPage.goto(baseURL);
        await visitorPage.setContent(`
          <!doctype html>
          <html lang="en">
            <body>
              <h1>Host application</h1>
              <button type="button">Give feedback</button>
            </body>
          </html>
        `);
        await visitorPage.addScriptTag({ path: sdkBundlePath });

        await visitorPage.evaluate(
          ({ host, identity, orgId }) => {
            const browserGlobal = globalThis as unknown as {
              Feeblo: {
                init: (
                  organizationId: string,
                  options: {
                    baseUrl: string;
                    user: {
                      email: string;
                      id: string;
                      name: string;
                      token: string;
                    };
                  }
                ) => { open: () => void };
              };
              addEventListener: (
                event: string,
                listener: (event: unknown) => void,
                options: { once: boolean }
              ) => void;
              document: { body: { dataset: Record<string, string> } };
            };

            browserGlobal.addEventListener(
              "feedbackSubmitted",
              (event: unknown) => {
                const submitted = event as {
                  detail: { data: { title: string } };
                };
                browserGlobal.document.body.dataset.submittedFeedback =
                  submitted.detail.data.title;
              },
              { once: true }
            );

            browserGlobal.Feeblo.init(orgId, {
              baseUrl: host,
              user: {
                id: identity.userId,
                email: identity.email,
                name: identity.name,
                token: identity.token,
              },
            }).open();
          },
          {
            host: baseURL,
            identity: { ...visitor, token },
            orgId: organizationId,
          }
        );

        const widget = visitorPage.frameLocator(
          "#feeblo-embed-container iframe"
        );
        await widget.getByRole("link", { name: "Features 💡" }).click();
        await widget
          .getByPlaceholder("Share your product feedback!")
          .fill(feedbackTitle);
        await widget
          .getByPlaceholder(
            "Help us understand what value this feature would bring to your team or workflow"
          )
          .fill(feedbackContent);
        const createFeedbackResponse = visitorPage.waitForResponse(
          (response) =>
            response.url().includes("/api/widget/v1/feedback") &&
            response.request().method() === "POST"
        );
        await widget.getByRole("button", { name: "Create a new post" }).click();
        const response = await createFeedbackResponse;
        expect(
          response.status(),
          `Widget API response: ${await response.text()}`
        ).toBe(200);

        await expect(
          widget.getByText("Thanks for your feedback", { exact: true })
        ).toBeVisible();
        await expect(visitorPage.locator("body")).toHaveAttribute(
          "data-submitted-feedback",
          feedbackTitle
        );
      });

      await test.step("use the same identity token for public-board SSO", async () => {
        const ssoResponse = await visitorContext.request.post(
          `${apiURL}/api/auth/sign-in/jwt-auto-login`,
          {
            data: { organizationId, token },
            headers: { Origin: baseURL },
          }
        );
        expect(ssoResponse.ok()).toBeTruthy();

        await visitorPage.goto(publicBoardUrl(owner.workspaceName));
        await expect(
          visitorPage.getByRole("button", { name: "Sign out" })
        ).toBeVisible();
        await expect(
          visitorPage.getByRole("button", { name: "Sign in" })
        ).toHaveCount(0);

        await visitorPage
          .getByRole("link", { name: new RegExp(feedbackTitle) })
          .click();
        await expect(visitorPage.getByText(feedbackContent)).toBeVisible();

        const upvoteButton = visitorPage.getByRole("button", {
          name: "Upvote",
        });
        await expect(upvoteButton).toContainText("0");
        await upvoteButton.click();
        await expect(upvoteButton).toContainText("1");
      });
    } finally {
      await visitorContext.close();
    }
  }
);
