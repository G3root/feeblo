import { createHmac } from "node:crypto";
import { describe, expect, it } from "@effect/vitest";
import {
  asLegid,
  IntegrationConnectionId,
  IntegrationDeliveryId,
  IntegrationEventId,
  IntegrationRouteId,
  WorkspaceId,
} from "@feeblo/id";
import type {
  IntegrationExternalResourceDraft,
  IntegrationProviderDeliveryInput,
} from "@feeblo/integration-core";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import type { GitHubApiClient } from "./github-api";
import { ParsedGitHubInboundRequest } from "./github-inbound-schema";
import { githubProviderKey } from "./github-manifest";
import { makeGitHubProviderRegistration } from "./github-provider-registration";

const deliveryInput: IntegrationProviderDeliveryInput = {
  connection: {
    credentialGeneration: 1,
    id: asLegid(IntegrationConnectionId)("conn_1"),
    lifecycleStatus: "active",
    name: "octocat",
    organizationId: asLegid(WorkspaceId)("org_1"),
    provider: githubProviderKey,
    safeMetadata: {},
  },
  delivery: {
    actionKey: "github.issue.create:route_1",
    attemptCount: 0,
    eventId: asLegid(IntegrationEventId)("event_1"),
    id: asLegid(IntegrationDeliveryId)("delivery_1"),
    leaseExpiresAt: null,
    leaseOwner: null,
    nextAttemptAt: DateTime.makeUnsafe(new Date()),
    orderingKey: null,
    routeId: asLegid(IntegrationRouteId)("route_1"),
    state: "pending",
  },
  event: {
    causalHopCount: 0,
    correlationId: "corr_1",
    data: {
      actor: { kind: "end_user" },
      board: { id: "brd_1", name: "Ideas", slug: "ideas" },
      post: {
        id: "pst_1",
        status: { id: "pss_1", type: "PENDING" },
        title: "Dark mode",
        url: "https://feeblo.example/org/post/ideas/dark-mode",
      },
    },
    id: asLegid(IntegrationEventId)("event_1"),
    occurredAt: DateTime.makeUnsafe(new Date()),
    organizationId: asLegid(WorkspaceId)("org_1"),
    origin: { kind: "feeblo" },
    type: "feedback.post.created",
    version: 1,
  },
  route: {
    capabilityKey: "github.issue.create",
    configVersion: 1,
    connectionId: asLegid(IntegrationConnectionId)("conn_1"),
    enabled: true,
    eventTypes: ["feedback.post.created"],
    id: asLegid(IntegrationRouteId)("route_1"),
    provider: githubProviderKey,
    providerConfig: {
      version: 1,
      repositoryOwner: "acme",
      repositoryName: "feedback",
    },
    safeMetadata: {},
  },
};

const apiClient: GitHubApiClient = {
  createIssueBacklinkComment: () => Effect.die("not used"),
  createIssue: () =>
    Effect.succeed({
      html_url: new URL("https://github.com/acme/feedback/issues/7"),
      id: 7,
      node_id: "I_7",
      number: 7,
      state: "open",
      title: "Dark mode",
    }),
  createInstallationAccessToken: () => Effect.die("not used"),
  deleteInstallation: () => Effect.die("not used"),
  exchangeUserAccessToken: () => Effect.die("not used"),
  getIssue: () => Effect.die("not used"),
  listInstallationRepositories: () => Effect.die("not used"),
  listUserInstallations: () => Effect.die("not used"),
};

describe("GitHub provider registration", () => {
  it.effect(
    "returns a decoded issue webhook value that is valid at the server boundary",
    () =>
      Effect.gen(function* () {
        const secret = Redacted.make("webhook-secret");
        const registration = makeGitHubProviderRegistration({
          apiClient,
          credentialResolver: {
            loadGitHubCredentials: () =>
              Effect.succeed({ accessToken: Redacted.make("token") }),
          },
          webhookSecret: secret,
        });
        const handler = registration.inboundHandlers[0];
        if (handler === undefined) {
          return;
        }
        const rawBody =
          '{"action":"closed","installation":{"id":42},"issue":{"html_url":"https://github.com/acme/feedback/issues/7","id":7,"node_id":"I_7","number":7,"state":"closed","title":"Dark mode"},"repository":{"full_name":"acme/feedback","id":1,"name":"feedback","owner":{"login":"acme"}},"sender":{"id":2,"login":"octocat"}}';
        const signature = `sha256=${createHmac("sha256", Redacted.value(secret)).update(rawBody).digest("hex")}`;
        const response = yield* handler.handle({
          headers: {
            "x-github-delivery": "delivery_issue_7",
            "x-github-event": "issues",
            "x-hub-signature-256": signature,
          },
          rawBody,
        });

        expect(response.status).toBe(200);
        const parsed = yield* Schema.decodeUnknownEffect(
          Schema.toType(ParsedGitHubInboundRequest)
        )(response.body);
        expect(parsed.kind).toBe("issue");
      })
  );

  it.effect("creates an issue whose body points back to Feeblo", () =>
    Effect.gen(function* () {
      let issueBody = "";
      let externalResourceDrafts:
        | readonly IntegrationExternalResourceDraft[]
        | undefined;
      const registration = makeGitHubProviderRegistration({
        apiClient: {
          ...apiClient,
          createIssue: (input) => {
            issueBody = input.body;
            return apiClient.createIssue(input);
          },
        },
        credentialResolver: {
          loadGitHubCredentials: () =>
            Effect.succeed({ accessToken: Redacted.make("token") }),
        },
        webhookSecret: Redacted.make("webhook-secret"),
      });
      const handler = registration.handlers[0];
      if (handler === undefined) {
        return;
      }
      const result = yield* Effect.exit(handler.deliver(deliveryInput));
      expect(Exit.isSuccess(result)).toBe(true);
      if (Exit.isSuccess(result)) {
        externalResourceDrafts = result.value.externalResourceDrafts;
      }
      expect(issueBody).toContain(
        "https://feeblo.example/org/post/ideas/dark-mode"
      );
      expect(externalResourceDrafts?.[0]?.remoteId).toBe("I_7");
      expect(externalResourceDrafts?.[0]?.stateKey).toBe("open");
      expect(externalResourceDrafts?.[0]?.remoteUrl.href).toBe(
        "https://github.com/acme/feedback/issues/7"
      );
    })
  );

  it.effect(
    "accepts a globally delivered signed installation-created webhook",
    () =>
      Effect.gen(function* () {
        const secret = Redacted.make("webhook-secret");
        const registration = makeGitHubProviderRegistration({
          apiClient,
          credentialResolver: {
            loadGitHubCredentials: () =>
              Effect.succeed({ accessToken: Redacted.make("token") }),
          },
          webhookSecret: secret,
        });
        const handler = registration.inboundHandlers[0];
        if (handler === undefined) {
          return;
        }
        const rawBody = '{"action":"created","installation":{"id":42}}';
        const signature = `sha256=${createHmac("sha256", Redacted.value(secret)).update(rawBody).digest("hex")}`;
        const response = yield* handler.handle({
          headers: {
            "x-github-delivery": "delivery_42",
            "x-github-event": "installation",
            "x-hub-signature-256": signature,
          },
          rawBody,
        });
        expect(response.status).toBe(200);
        const parsed = yield* Schema.decodeUnknownEffect(
          ParsedGitHubInboundRequest
        )(response.body);
        expect(parsed.kind).toBe("installation");
        if (parsed.kind === "installation") {
          expect(parsed.payload.installation.id).toBe(42);
        }
      })
  );
});
