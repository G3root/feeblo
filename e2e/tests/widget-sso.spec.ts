import { createHmac, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { createAuthenticatedWorkspace } from "../helpers/auth";
import { setPlan } from "../helpers/set-plan";
import { createTestUser } from "../helpers/test-users";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3101";
const apiURL = process.env.E2E_API_URL ?? "http://localhost:3100";
const organizationIdPattern = /^org_/;
const ssoTokenPattern = /ssoToken/;
const sdkBundlePath = fileURLToPath(
  new URL("../../packages/sdk/dist/feeblo-sdk.umd.cjs", import.meta.url)
);

function signWidgetToken(
  secret: string,
  identity: { email: string; name: string; userId: string },
  organizationId: string
) {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" })
  ).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      ...identity,
      iat: now,
      exp: now + 5 * 60,
      // Pins the token to exactly one workspace: the server rejects tokens
      // without (or with a mismatched) aud claim.
      aud: organizationId,
    })
  ).toString("base64url");
  const unsignedToken = `${header}.${payload}`;
  const key = Buffer.from(secret, "hex");
  const signature = createHmac("sha256", key)
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
      .find(Boolean);

    if (!organizationId) {
      throw new Error("Workspace URL did not contain an organization id");
    }
    expect(organizationId).toMatch(organizationIdPattern);

    // Widget SSO is a paid capability (Starter plan or higher): a fresh
    // workspace signs up on the free plan, so put it on Starter before
    // exercising the JWT auto-login flow.
    await setPlan(page.request, { organizationId, plan: "starter" });

    await test.step("copy the workspace JWT secret", async () => {
      await page
        .context()
        .grantPermissions(["clipboard-read", "clipboard-write"], {
          origin: baseURL,
        });
      await page.goto(`/${organizationId}/settings/security`);

      // Secret creation is explicit: a fresh workspace has no active JWT
      // secret, so the page offers "Generate Secret" until an admin creates
      // one. Generate it when needed so the "Copy Secret" button is present.
      const copySecretButton = page.getByRole("button", {
        name: "Copy Secret",
      });
      const generateSecretButton = page.getByRole("button", {
        name: "Generate Secret",
      });
      await Promise.race([
        copySecretButton.waitFor({ state: "visible" }),
        generateSecretButton.waitFor({ state: "visible" }),
      ]);
      if (await generateSecretButton.isVisible()) {
        await generateSecretButton.click();
        await expect(
          page.getByText("Secret generated successfully")
        ).toBeVisible();
        await expect(copySecretButton).toBeVisible();
      }

      await copySecretButton.click();
      await expect(page.getByText("Secret copied to clipboard")).toBeVisible();
    });

    const secret = await page.evaluate(() => {
      // SAFETY: the browser under test always provides clipboard access; the
      // intersection only narrows the known global shape.
      const browserNavigator = (
        globalThis as typeof globalThis & {
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
    const token = signWidgetToken(secret, visitor, organizationId);
    const feedbackTitle = `Widget feedback ${randomUUID().slice(0, 8)}`;
    const feedbackContent =
      "Submitted from the embedded feedback widget by an identified user.";
    const boardUrl = publicBoardUrl(owner.workspaceName);
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
              <a href="${boardUrl}" data-feeblo-link>Open public board</a>
            </body>
          </html>
        `);
        await visitorPage.addScriptTag({ path: sdkBundlePath });

        await visitorPage.evaluate(
          ({ host, identity, orgId }) => {
            type WidgetHandle = {
              close: () => WidgetHandle;
              open: () => WidgetHandle;
            };
            // SAFETY: the SDK bundle below registers Feeblo on the page
            // global before this evaluate step runs.
            const browserGlobal = globalThis as typeof globalThis & {
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
                ) => WidgetHandle;
              };
              e2eWidget?: WidgetHandle;
              document: { body: { dataset: Record<string, string> } };
            };

            browserGlobal.addEventListener(
              "feedbackSubmitted",
              (event) => {
                // SAFETY: The SDK dispatches "feedbackSubmitted" as a
                // CustomEvent whose detail carries the submitted title.
                const { title } = (
                  event as CustomEvent<{ data: { title: string } }>
                ).detail.data;
                browserGlobal.document.body.dataset.submittedFeedback = title;
              },
              { once: true }
            );

            browserGlobal.e2eWidget = browserGlobal.Feeblo.init(orgId, {
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

      await test.step("auto-login through a data-feeblo-link", async () => {
        await visitorPage.evaluate(() => {
          // SAFETY: the widget sets e2eWidget on the page global for tests.
          const browserGlobal = globalThis as typeof globalThis & {
            e2eWidget?: { close: () => void };
          };
          browserGlobal.e2eWidget?.close();
        });
        await expect(
          visitorPage.locator("#feeblo-embed-container")
        ).toBeHidden();

        const publicBoardLink = visitorPage.getByRole("link", {
          name: "Open public board",
        });
        await expect(publicBoardLink).not.toHaveAttribute(
          "href",
          ssoTokenPattern
        );

        const autoLoginResponse = visitorPage.waitForResponse(
          (response) =>
            response.url() === `${apiURL}/api/auth/sign-in/jwt-auto-login` &&
            response.request().method() === "POST"
        );
        await publicBoardLink.click();

        const response = await autoLoginResponse;
        expect(
          response.ok(),
          `JWT auto-login response: ${await response.text()}`
        ).toBeTruthy();

        await expect(visitorPage).toHaveURL((url) => {
          return (
            url.origin === boardUrl &&
            !url.searchParams.has("ssoToken") &&
            !url.hash.includes("ssoToken")
          );
        });

        const cookies = await visitorContext.cookies(apiURL);
        expect(
          cookies.some((cookie) => cookie.name === "better-auth.session_token")
        ).toBeTruthy();

        await expect(
          visitorPage.getByRole("button", { name: "Sign in / Sign up" })
        ).toHaveCount(0);
        await expect(
          visitorPage.getByRole("button", { name: "User menu" })
        ).toBeVisible();

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
