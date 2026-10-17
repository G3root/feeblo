import { randomUUID } from "node:crypto";

import { expect, test } from "../fixtures";
import { createAuthenticatedWorkspace } from "../helpers/auth";
import { waitForHydration } from "../helpers/hydration";
import { assertNoPageErrors, trackPageErrors } from "../helpers/page-errors";
import { setPlan } from "../helpers/set-plan";
import { createTestUser } from "../helpers/test-users";
import { apiUrl, publicBoardUrl, webUrl } from "../helpers/urls";
import {
  copyWorkspaceJwtSecret,
  sdkBundlePath,
  signWidgetToken,
} from "../helpers/widget-sso";

const organizationIdPattern = /^org_/;
const ssoTokenPattern = /ssoToken/;

test("an SSO visitor never paints the sign-in button while the token exchanges", async ({
  browser,
  page,
}) => {
  const owner = createTestUser();
  const workspace = await createAuthenticatedWorkspace(page, owner);
  const organizationId = new URL(workspace.organizationUrl).pathname
    .split("/")
    .find(Boolean);

  if (!organizationId) {
    throw new Error("Workspace URL did not contain an organization id");
  }

  await setPlan(page.request, { organizationId, plan: "starter" });
  const secret = await copyWorkspaceJwtSecret(page, organizationId);

  const token = signWidgetToken(
    secret,
    {
      userId: `visitor-${randomUUID().slice(0, 12)}`,
      name: "SSO Flash Visitor",
      email: `sso-flash-${randomUUID().slice(0, 12)}@feeblo.dev`,
    },
    organizationId
  );

  const boardUrl = publicBoardUrl(owner.workspaceName);
  const visitorContext = await browser.newContext();
  const visitorPage = await visitorContext.newPage();
  trackPageErrors(visitorPage);

  try {
    // Hold both legs of the exchange open: the session probe's answer is what
    // would otherwise paint the signed-out navbar, and the token exchange is
    // what proves the probe's answer is already stale.
    let releaseSession!: () => void;
    const sessionGate = new Promise<void>((resolve) => {
      releaseSession = resolve;
    });
    let releaseExchange!: () => void;
    const exchangeGate = new Promise<void>((resolve) => {
      releaseExchange = resolve;
    });
    await visitorPage.route("**/api/auth/get-session**", async (route) => {
      await sessionGate;
      await route.continue();
    });
    await visitorPage.route(
      "**/api/auth/sign-in/jwt-auto-login",
      async (route) => {
        await exchangeGate;
        await route.continue();
      }
    );

    const exchangeStarted = visitorPage.waitForRequest(
      "**/api/auth/sign-in/jwt-auto-login"
    );

    await visitorPage.goto(
      `${boardUrl}/#ssoToken=${encodeURIComponent(token)}`
    );
    await waitForHydration(visitorPage);

    await expect(visitorPage.locator("html")).toHaveAttribute(
      "data-auth",
      "exchanging"
    );

    // Let the session probe answer `null` while the token exchange is still
    // in flight. Issuing the exchange request proves that answer has landed:
    // a navbar driven by the atom alone would now paint the sign-in button.
    releaseSession();
    await exchangeStarted;

    await expect(
      visitorPage.getByRole("button", { name: "Sign in / Sign up" })
    ).toBeHidden();
    await expect(
      visitorPage.locator('[data-auth-slot="account"]')
    ).toBeVisible();

    releaseExchange();
    await expect(
      visitorPage.getByRole("button", { name: "User menu" })
    ).toBeVisible();
    await expect(
      visitorPage.getByRole("button", { name: "Sign in / Sign up" })
    ).toBeHidden();

    await assertNoPageErrors(visitorPage);
  } finally {
    await visitorContext.close();
  }
});

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

    let secret = "";

    // Widget SSO is a paid capability (Starter plan or higher): a fresh
    // workspace signs up on the free plan, so put it on Starter before
    // exercising the JWT auto-login flow.
    await setPlan(page.request, { organizationId, plan: "starter" });

    await test.step("copy the workspace JWT secret", async () => {
      secret = await copyWorkspaceJwtSecret(page, organizationId);
    });

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
        await visitorPage.goto(webUrl());
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
            host: webUrl(),
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
        await widget.getByLabel("Details").fill(feedbackContent);
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
            response.url() === `${apiUrl()}/api/auth/sign-in/jwt-auto-login` &&
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

        const cookies = await visitorContext.cookies(apiUrl());
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
