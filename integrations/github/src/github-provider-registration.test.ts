import { createHmac } from "node:crypto";

import { describe, expect, it } from "@effect/vitest";
import {
  asLegid,
  IntegrationConnectionId,
  IntegrationDeliveryId,
  IntegrationEventId,
  IntegrationRouteId,
  PostId,
  WorkspaceId,
} from "@feeblo/id";
import {
  type IntegrationExternalResourceDraft,
  type IntegrationProviderDeliveryInput,
  IntegrationProviderInvalidConfigurationError,
  IntegrationProviderTemporaryFailure,
} from "@feeblo/integration-core";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import type { GitHubApiClient, GitHubIssue } from "./github-api";
import { makeGitHubIssueExternalResourceDraft } from "./github-external-resource";
import { ParsedGitHubInboundRequest } from "./github-inbound-schema";
import {
  githubIssueCreateCapabilityKey,
  githubProviderKey,
} from "./github-manifest";
import {
  makeGitHubCredentialResolver,
  makeGitHubProviderRegistration,
} from "./github-provider-registration";

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
        description: "Dark mode hurts my eyes at night.",
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
    capabilityKey: githubIssueCreateCapabilityKey,
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

  it.effect(
    "creates an issue from the post description and comments the Feeblo backlink",
    () =>
      Effect.gen(function* () {
        let issueBody = "";
        let commentedBacklinkUrl: URL | undefined;
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
            createIssueBacklinkComment: (input) => {
              commentedBacklinkUrl = input.backlinkUrl;
              return Effect.void;
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
        expect(issueBody).toBe("Dark mode hurts my eyes at night.");
        expect(commentedBacklinkUrl?.href).toBe(
          "https://feeblo.example/org/post/ideas/dark-mode"
        );
        expect(externalResourceDrafts?.[0]?.remoteId).toBe("I_7");
        expect(externalResourceDrafts?.[0]?.stateKey).toBe("open");
        expect(externalResourceDrafts?.[0]?.title).toBe("Dark mode");
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

describe("makeGitHubIssueExternalResourceDraft", () => {
  it("normalizes a GitHub issue into a provider-neutral resource", () => {
    const issue: GitHubIssue = {
      html_url: new URL("https://github.com/acme/feedback/issues/7"),
      id: 7,
      node_id: "I_7",
      number: 7,
      state: "open",
      title: "Dark mode",
    };
    const draft = makeGitHubIssueExternalResourceDraft({
      issueNumber: issue.number,
      postId: asLegid(PostId)("pst_1"),
      repositoryName: "feedback",
      repositoryOwner: "acme",
      remoteId: issue.node_id,
      remoteUrl: issue.html_url,
      state: issue.state,
      title: issue.title,
    });

    expect(draft.displayKey).toBe("acme/feedback#7");
    expect(draft.remoteId).toBe("I_7");
    expect(draft.stateKey).toBe("open");
    expect(draft.remoteUrl.href).toBe(
      "https://github.com/acme/feedback/issues/7"
    );
    expect(draft.resourceType).toBe("issue");
    expect(draft.safeMetadata).toEqual({
      issueNumber: 7,
      repositoryName: "feedback",
      repositoryOwner: "acme",
    });
    expect(draft.title).toBe("Dark mode");
  });
});

describe("GitHub provider credential resolver", () => {
  const installationTokenResolver = {
    getInstallationAccessToken: ({
      installationId,
    }: {
      readonly installationId: string;
    }) => Effect.succeed(Redacted.make(`token_${installationId}`)),
  };

  it.effect("mints credentials for an installed connection", () =>
    Effect.gen(function* () {
      const resolver = makeGitHubCredentialResolver({
        installationTokenResolver,
        loadInstallationId: () => Effect.succeed("12345"),
      });

      const credentials = yield* resolver.loadGitHubCredentials(deliveryInput);

      expect(Redacted.value(credentials.accessToken)).toBe("token_12345");
    })
  );

  it.effect("rejects a connection without a GitHub installation", () =>
    Effect.gen(function* () {
      const resolver = makeGitHubCredentialResolver({
        installationTokenResolver,
        loadInstallationId: () => Effect.succeed(null),
      });

      const tag = yield* resolver.loadGitHubCredentials(deliveryInput).pipe(
        Effect.match({
          onFailure: (error) => error._tag,
          onSuccess: () => "success",
        })
      );

      expect(tag).toBe("IntegrationProviderInvalidConfigurationError");
    })
  );

  it.effect("maps token minting failures to a temporary provider failure", () =>
    Effect.gen(function* () {
      const resolver = makeGitHubCredentialResolver({
        installationTokenResolver: {
          getInstallationAccessToken: () =>
            Effect.fail(
              new IntegrationProviderTemporaryFailure({
                message: "mint failed",
                provider: githubProviderKey,
              })
            ),
        },
        loadInstallationId: () => Effect.succeed("12345"),
      });

      const tag = yield* resolver.loadGitHubCredentials(deliveryInput).pipe(
        Effect.match({
          onFailure: (error) => error._tag,
          onSuccess: () => "success",
        })
      );

      expect(tag).toBe("IntegrationProviderTemporaryFailure");
    })
  );

  it.effect("retains invalid configuration failures from token minting", () =>
    Effect.gen(function* () {
      const resolver = makeGitHubCredentialResolver({
        installationTokenResolver: {
          getInstallationAccessToken: () =>
            Effect.fail(
              new IntegrationProviderInvalidConfigurationError({
                message: "mint configuration invalid",
                provider: githubProviderKey,
              })
            ),
        },
        loadInstallationId: () => Effect.succeed("12345"),
      });

      const tag = yield* resolver.loadGitHubCredentials(deliveryInput).pipe(
        Effect.match({
          onFailure: (error) => error._tag,
          onSuccess: () => "success",
        })
      );

      expect(tag).toBe("IntegrationProviderInvalidConfigurationError");
    })
  );
});

describe("GitHub App webhook handler", () => {
  const webhookSecret = Redacted.make("webhook-secret");
  const signatureFor = (rawBody: string) =>
    `sha256=${createHmac("sha256", Redacted.value(webhookSecret))
      .update(rawBody)
      .digest("hex")}`;

  const makeHandler = () => {
    const registration = makeGitHubProviderRegistration({
      apiClient,
      credentialResolver: {
        loadGitHubCredentials: () =>
          Effect.succeed({ accessToken: Redacted.make("token") }),
      },
      webhookSecret,
    });
    return registration.inboundHandlers[0];
  };

  it.effect("rejects a delivery with an invalid signature", () =>
    Effect.gen(function* () {
      const handler = makeHandler();
      if (handler === undefined) {
        return;
      }
      const response = yield* handler.handle({
        headers: {
          "x-github-delivery": "delivery_1",
          "x-github-event": "issues",
          "x-hub-signature-256": "sha256=deadbeef",
        },
        rawBody: '{"action":"opened"}',
      });

      expect(response.status).toBe(401);
      expect(response.body).toBe("invalid request signature");
    })
  );

  it.effect("acknowledges an unsupported GitHub event without retrying", () =>
    Effect.gen(function* () {
      const handler = makeHandler();
      if (handler === undefined) {
        return;
      }
      const rawBody = '{"ref":"refs/heads/main"}';
      const response = yield* handler.handle({
        headers: {
          "x-github-delivery": "delivery_push_1",
          "x-github-event": "push",
          "x-hub-signature-256": signatureFor(rawBody),
        },
        rawBody,
      });

      expect(response.status).toBe(202);
      expect(response.body).toBe("unsupported GitHub webhook event");
    })
  );

  it.effect("rejects a malformed issue payload", () =>
    Effect.gen(function* () {
      const handler = makeHandler();
      if (handler === undefined) {
        return;
      }
      const rawBody = '{"action":"opened"}';
      const response = yield* handler.handle({
        headers: {
          "x-github-delivery": "delivery_bad_1",
          "x-github-event": "issues",
          "x-hub-signature-256": signatureFor(rawBody),
        },
        rawBody,
      });

      expect(response.status).toBe(400);
      expect(response.body).toBe("invalid request payload");
    })
  );

  it.effect("rejects a signed delivery that is missing its delivery id", () =>
    Effect.gen(function* () {
      const handler = makeHandler();
      if (handler === undefined) {
        return;
      }
      const rawBody = '{"action":"opened"}';
      const response = yield* handler.handle({
        headers: {
          "x-github-event": "issues",
          "x-hub-signature-256": signatureFor(rawBody),
        },
        rawBody,
      });

      expect(response.status).toBe(400);
      expect(response.body).toBe("invalid request payload");
    })
  );
});

describe("GitHub issue-create handler", () => {
  const makeHandler = () => {
    const registration = makeGitHubProviderRegistration({
      apiClient,
      credentialResolver: {
        loadGitHubCredentials: () =>
          Effect.succeed({ accessToken: Redacted.make("token") }),
      },
      webhookSecret: Redacted.make("webhook-secret"),
    });
    return registration.handlers[0];
  };

  it.effect("rejects events that are not new posts", () =>
    Effect.gen(function* () {
      const handler = makeHandler();
      if (handler === undefined) {
        return;
      }
      const tag = yield* handler
        .deliver({
          ...deliveryInput,
          event: {
            ...deliveryInput.event,
            type: "feedback.post.status_changed",
          },
        })
        .pipe(
          Effect.match({
            onFailure: (error) => error._tag,
            onSuccess: () => "success",
          })
        );

      expect(tag).toBe("IntegrationProviderInvalidConfigurationError");
    })
  );

  it.effect(
    "skips creation when the route board does not match the post board",
    () =>
      Effect.gen(function* () {
        const handler = makeHandler();
        if (handler === undefined) {
          return;
        }
        const result = yield* handler.deliver({
          ...deliveryInput,
          route: {
            ...deliveryInput.route,
            providerConfig: {
              version: 1,
              repositoryOwner: "acme",
              repositoryName: "feedback",
              boardId: "brd_other",
            },
          },
        });

        expect(result.externalResourceDrafts).toBeUndefined();
        expect(result.httpStatus).toBeUndefined();
      })
  );
});
