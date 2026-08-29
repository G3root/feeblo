import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3101";
const apiURL = process.env.E2E_API_URL ?? "http://localhost:3100";

export const sdkBundlePath = fileURLToPath(
  new URL("../../packages/sdk/dist/feeblo-sdk.umd.cjs", import.meta.url)
);

export type WidgetSsoIdentity = {
  userId: string;
  name: string;
  email: string;
};

export function signWidgetToken(
  secret: string,
  identity: WidgetSsoIdentity,
  organizationId: string
) {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" })
  ).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      // `sub` is the standard JWT subject claim used as the contact's stable
      // external id. Keep the browser-side `userId` naming separate from the
      // token contract.
      sub: identity.userId,
      email: identity.email,
      name: identity.name,
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

/**
 * Copies the workspace JWT secret from the dashboard security settings,
 * generating it first when the workspace has no active secret yet. Widget SSO
 * is a paid capability (Starter plan or higher), so the caller must put the
 * workspace on an eligible plan before invoking this helper.
 */
export async function copyWorkspaceJwtSecret(
  page: Page,
  organizationId: string
): Promise<string> {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: baseURL,
  });
  await page.goto(`/${organizationId}/settings/security`);

  const copySecretButton = page.getByRole("button", { name: "Copy Secret" });
  const generateSecretButton = page.getByRole("button", {
    name: "Generate Secret",
  });
  // Secret creation is explicit: a fresh workspace has no active JWT secret,
  // so the page offers "Generate Secret" until an admin creates one. Generate
  // it when needed so the "Copy Secret" button is present.
  await Promise.race([
    copySecretButton.waitFor({ state: "visible" }),
    generateSecretButton.waitFor({ state: "visible" }),
  ]);
  if (await generateSecretButton.isVisible()) {
    await generateSecretButton.click();
    await expect(page.getByText("Secret generated successfully")).toBeVisible();
    await expect(copySecretButton).toBeVisible();
  }

  await copySecretButton.click();
  await expect(page.getByText("Secret copied to clipboard")).toBeVisible();

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
  return secret;
}

/**
 * Signs a visitor in through the widget JWT auto-login flow, producing a
 * session restricted to `organizationId` (see
 * `Auth/plugins/jwt-auto-login`). The visitor opens a minimal host page that
 * embeds the SDK, clicks a `data-feeblo-link` pointing at the public board,
 * and lands on the board authenticated without ever entering credentials.
 *
 * Returns the fresh visitor context and page so callers can close the
 * context when done.
 */
export async function signInRestrictedSsoVisitor(
  browser: Browser,
  options: {
    boardUrl: string;
    identity: WidgetSsoIdentity;
    organizationId: string;
    secret: string;
  }
): Promise<{ context: BrowserContext; page: Page }> {
  const { boardUrl, identity, organizationId, secret } = options;
  const token = signWidgetToken(secret, identity, organizationId);

  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(baseURL);
  await page.setContent(`
    <!doctype html>
    <html lang="en">
      <body>
        <h1>Host application</h1>
        <a href="${boardUrl}" data-feeblo-link>Open public board</a>
      </body>
    </html>
  `);
  await page.addScriptTag({ path: sdkBundlePath });

  await page.evaluate(
    ({ host, orgId, userId, userEmail, userName, ssoToken }) => {
      type WidgetHandle = { close: () => WidgetHandle };
      // SAFETY: the SDK bundle above registers Feeblo on the page global
      // before this evaluate step runs.
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
      };

      browserGlobal.Feeblo.init(orgId, {
        baseUrl: host,
        user: {
          id: userId,
          email: userEmail,
          name: userName,
          token: ssoToken,
        },
      });
    },
    {
      host: baseURL,
      orgId: organizationId,
      ssoToken: token,
      userEmail: identity.email,
      userId: identity.userId,
      userName: identity.name,
    }
  );

  const autoLoginResponse = page.waitForResponse(
    (response) =>
      response.url() === `${apiURL}/api/auth/sign-in/jwt-auto-login` &&
      response.request().method() === "POST"
  );
  await page.getByRole("link", { name: "Open public board" }).click();

  const response = await autoLoginResponse;
  expect(
    response.ok(),
    `JWT auto-login response: ${await response.text()}`
  ).toBeTruthy();

  const boardOrigin = new URL(boardUrl).origin;
  await expect(page).toHaveURL((url) => {
    return (
      url.origin === boardOrigin &&
      !url.searchParams.has("ssoToken") &&
      !url.hash.includes("ssoToken")
    );
  });

  const cookies = await context.cookies(apiURL);
  expect(
    cookies.some((cookie) => cookie.name === "better-auth.session_token")
  ).toBeTruthy();

  await expect(
    page.getByRole("button", { name: "Sign in / Sign up" })
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "User menu" })).toBeVisible();

  return { context, page };
}
