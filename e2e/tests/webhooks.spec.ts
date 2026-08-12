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
    const organizationId = new URL(owner.organizationUrl).pathname
      .split("/")
      .filter(Boolean)[0];
    if (!organizationId) {
      throw new Error("Workspace URL did not contain an organization id");
    }

    await page.goto(`${owner.organizationUrl}/settings/webhooks`);
    await expect(page.getByRole("heading", { name: "Webhooks" })).toBeVisible();

    await page.getByRole("button", { name: "New endpoint" }).click();
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
    await expect(endpoint).toContainText("127.0.0.1");

    // The list page is an index; management happens on the detail page.
    await endpoint.getByRole("link", { name: "Details" }).click();
    await expect(
      page.getByRole("heading", { name: "Product events" })
    ).toBeVisible();

    const history = page.getByLabel("Webhook delivery history");
    const refreshHistory = async () => {
      await history.getByRole("button", { name: "Refresh" }).click();
    };
    const refreshHistoryUntil = async (expected: string) => {
      await expect
        .poll(async () => {
          await refreshHistory();
          return (await history.textContent()) ?? "";
        })
        .toContain(expected);
    };

    await page.getByRole("button", { name: "Test", exact: true }).click();
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

    await refreshHistoryUntil("succeeded");
    const deliveryRow = history
      .getByRole("row")
      .filter({ hasText: "webhook.test" });

    receiverStatus = 400;
    await page.getByRole("button", { name: "Test", exact: true }).click();
    const failedWebhook = await waitForWebhook(1);
    await refreshHistoryUntil("exhausted");
    const exhaustedRow = history
      .getByRole("row")
      .filter({ hasText: "exhausted" });
    await expect(
      exhaustedRow.getByRole("button", { name: "Retry" })
    ).toBeVisible();

    receiverStatus = 204;
    await exhaustedRow.getByRole("button", { name: "Retry" }).click();
    const retriedWebhook = await waitForWebhook(2);
    expect(retriedWebhook.headers["webhook-id"]).toBe(
      failedWebhook.headers["webhook-id"]
    );
    await expect
      .poll(async () => {
        await refreshHistory();
        const attemptsCell = deliveryRow
          .filter({ hasText: "succeeded" })
          .getByRole("cell")
          .nth(2);
        return (await attemptsCell.textContent()) ?? "";
      })
      .toBe("2");

    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Name").fill("Product events v2");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(
      page.getByText("Webhook endpoint updated", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Product events v2" })
    ).toBeVisible();

    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

    await page.getByRole("button", { name: "Rotate secret" }).click();
    await expect(page.getByLabel("Webhook signing secret")).toBeVisible();
    await page
      .getByLabel("Webhook signing secret")
      .getByRole("button", { name: "Done" })
      .click();

    await page.getByRole("button", { name: "Remove" }).click();
    const removal = page.getByRole("alertdialog", {
      name: "Remove webhook endpoint?",
    });
    await expect(removal).toContainText("erased immediately");
    await removal.getByRole("button", { name: "Remove endpoint" }).click();
    await expect(
      page.getByText("Webhook endpoint removed", { exact: true })
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Webhooks" })).toBeVisible();
    await expect(
      page.getByText("No webhook endpoints yet.", { exact: true })
    ).toBeVisible();
  } finally {
    await close(receiver);
  }
});
