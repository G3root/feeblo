import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { expect, test } from "@playwright/test";
import { createAuthenticatedWorkspace } from "../helpers/auth";

interface ReceivedWebhook {
  readonly body: string;
  readonly headers: IncomingHttpHeaders;
}

const webhookSecretPattern = /^whsec_/;

const listen = (server: ReturnType<typeof createServer>) =>
  new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address !== null && typeof address === "object") {
        resolve(address.port);
      }
    });
  });

const close = (server: ReturnType<typeof createServer>) =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });

const verifyStandardWebhookSignature = (
  secret: string,
  webhook: ReceivedWebhook
): boolean => {
  const deliveryId = webhook.headers["webhook-id"];
  const timestamp = webhook.headers["webhook-timestamp"];
  const signatureHeader = webhook.headers["webhook-signature"];
  if (
    typeof deliveryId !== "string" ||
    typeof timestamp !== "string" ||
    typeof signatureHeader !== "string" ||
    !secret.startsWith("whsec_")
  ) {
    return false;
  }
  const expected = createHmac(
    "sha256",
    Buffer.from(secret.slice("whsec_".length), "base64")
  )
    .update(`${deliveryId}.${timestamp}.${webhook.body}`)
    .digest();
  return signatureHeader.split(" ").some((versionedSignature) => {
    const [version, encoded] = versionedSignature.split(",");
    if (version !== "v1" || encoded === undefined) {
      return false;
    }
    const actual = Buffer.from(encoded, "base64");
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  });
};

test("owner manages an endpoint and receives a signed test delivery", async ({
  page,
}) => {
  const receivedWebhooks: ReceivedWebhook[] = [];
  const webhookWaiters = new Map<number, (webhook: ReceivedWebhook) => void>();
  const waitForWebhook = (index: number) => {
    const received = receivedWebhooks[index];
    if (received !== undefined) {
      return Promise.resolve(received);
    }
    return new Promise<ReceivedWebhook>((resolve) => {
      webhookWaiters.set(index, resolve);
    });
  };
  let receiverStatus = 204;
  const receiver = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const webhook = {
        body: Buffer.concat(chunks).toString("utf8"),
        headers: request.headers,
      };
      const index = receivedWebhooks.push(webhook) - 1;
      webhookWaiters.get(index)?.(webhook);
      webhookWaiters.delete(index);
      response.writeHead(receiverStatus).end();
    });
  });

  const port = await listen(receiver);
  try {
    const owner = await createAuthenticatedWorkspace(page);
    await page.goto(`${owner.organizationUrl}/settings/webhooks`);
    await expect(page.getByRole("heading", { name: "Webhooks" })).toBeVisible();

    await page.getByLabel("Name").fill("Product events");
    await page
      .getByLabel("Endpoint URL")
      .fill(`http://127.0.0.1:${port}/events`);
    await page.getByRole("button", { name: "Create endpoint" }).click();

    await expect(
      page.getByText("Webhook endpoint created", { exact: true })
    ).toBeVisible();
    const secretSection = page.getByLabel("Webhook signing secret");
    await expect(secretSection).toContainText("will not be shown again");
    const signingSecret = await secretSection.locator("code").innerText();
    expect(signingSecret).toMatch(webhookSecretPattern);
    await secretSection.getByRole("button", { name: "Done" }).click();
    await expect(secretSection).toHaveCount(0);

    const endpoint = page
      .getByRole("article")
      .filter({ hasText: "Product events" });
    const history = page.getByLabel("Webhook delivery history");
    const refreshHistoryUntil = async (expected: string) => {
      await expect
        .poll(async () => {
          await endpoint.getByRole("button", { name: "History" }).click();
          return await history.textContent();
        })
        .toContain(expected);
    };
    await expect(endpoint).toContainText("127.0.0.1");
    await endpoint.getByRole("button", { name: "Test", exact: true }).click();
    await expect(
      page.getByText("Test delivery queued", { exact: true })
    ).toBeVisible();

    const webhook = await waitForWebhook(0);
    expect(webhook.headers["content-type"]).toBe("application/json");
    expect(webhook.headers["x-feeblo-event"]).toBe("webhook.test");
    expect(webhook.headers["user-agent"]).toBe("Feeblo-Webhooks/1");
    expect(verifyStandardWebhookSignature(signingSecret, webhook)).toBe(true);
    expect(JSON.parse(webhook.body)).toMatchObject({
      actor: { type: "member" },
      type: "webhook.test",
      version: 1,
    });

    await refreshHistoryUntil("webhook.test · succeeded · 1 attempts");

    receiverStatus = 400;
    await endpoint.getByRole("button", { name: "Test", exact: true }).click();
    const failedWebhook = await waitForWebhook(1);
    await refreshHistoryUntil("webhook.test · exhausted · 1 attempts");
    const exhaustedDelivery = history.locator("details").filter({
      hasText: "webhook.test · exhausted · 1 attempts",
    });
    await expect(exhaustedDelivery).toBeVisible();

    receiverStatus = 204;
    await exhaustedDelivery.locator("summary").click();
    await exhaustedDelivery
      .getByRole("button", { name: "Retry delivery" })
      .click();
    const retriedWebhook = await waitForWebhook(2);
    expect(retriedWebhook.headers["webhook-id"]).toBe(
      failedWebhook.headers["webhook-id"]
    );
    await refreshHistoryUntil("webhook.test · succeeded · 2 attempts");

    await endpoint.getByRole("button", { name: "Pause" }).click();
    await expect(
      endpoint.getByRole("button", { name: "Resume" })
    ).toBeVisible();
    await endpoint.getByRole("button", { name: "Resume" }).click();
    await expect(endpoint.getByRole("button", { name: "Pause" })).toBeVisible();

    await endpoint.getByRole("button", { name: "Rotate secret" }).click();
    await expect(page.getByLabel("Webhook signing secret")).toBeVisible();
    await page
      .getByLabel("Webhook signing secret")
      .getByRole("button", { name: "Done" })
      .click();

    await endpoint.getByRole("button", { name: "Remove" }).click();
    const removal = page.getByRole("alertdialog", {
      name: "Remove webhook endpoint?",
    });
    await expect(removal).toContainText("erased immediately");
    await removal.getByRole("button", { name: "Remove endpoint" }).click();
    await expect(endpoint).toHaveCount(0);
  } finally {
    await close(receiver);
  }
});
