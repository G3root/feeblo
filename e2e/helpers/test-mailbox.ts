import { type APIRequestContext, expect } from "@playwright/test";

const apiURL = process.env.E2E_API_URL ?? "http://localhost:3100";

export interface TestEmail {
  readonly from?: string;
  readonly html: string;
  readonly subject: string;
  readonly text: string;
  readonly to: string;
}

const mailboxUrl = `${apiURL}/__e2e/emails`;
const invitationPathPattern = /\/invitation\/([^"<\s]+)/;

export async function getTestEmails(
  request: APIRequestContext
): Promise<readonly TestEmail[]> {
  const response = await request.get(mailboxUrl);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { readonly emails: TestEmail[] };
  return body.emails;
}

export async function waitForTestEmail(
  request: APIRequestContext,
  recipient: string
): Promise<TestEmail> {
  let matchingEmail: TestEmail | undefined;

  await expect(async () => {
    const emails = await getTestEmails(request);
    matchingEmail = emails.find(
      (email) =>
        email.to.toLowerCase() === recipient.toLowerCase() &&
        invitationPathPattern.test(email.html)
    );
    expect(matchingEmail).toBeDefined();
  }).toPass();

  return matchingEmail as TestEmail;
}

export function invitationIdFromEmail(email: TestEmail): string {
  const match = email.html.match(invitationPathPattern);
  expect(match?.[1]).toBeTruthy();
  return decodeURIComponent(match?.[1] ?? "");
}
