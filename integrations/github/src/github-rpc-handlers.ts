import { EntitlementPolicy } from "@feeblo/domain/entitlement/policies";
import { GitHubManagementService } from "@feeblo/domain/integration/github/management-service";
import { GitHubManagementRpcs } from "@feeblo/domain/integration/github/rpcs";
import * as Policy from "@feeblo/domain/policy";
import { withRemapDbErrors } from "@feeblo/domain/rpc-errors";
import * as Effect from "effect/Effect";

/** RPC handlers authorize GitHub management before delegating provider-specific work to the application service. */
export const GitHubManagementRpcHandlersEffect = Effect.gen(function* () {
  const service = yield* GitHubManagementService;
  const entitlementPolicy = yield* EntitlementPolicy;
  const authorize = (organizationId: string) =>
    Policy.withPolicy(
      Policy.canPermission(organizationId, "integrations.manage")
    );
  return {
    GetGitHubIntegrationStatus: () => service.status,
    ListGitHubConnections: (
      input: Parameters<typeof service.listConnections>[0]
    ) => service.listConnections(input).pipe(authorize(input.organizationId)),
    StartGitHubConnect: (input: Parameters<typeof service.connectStart>[0]) =>
      Effect.gen(function* () {
        // Starting an App installation additionally requires the plan's
        // integrations capability. Existing connections stay manageable, so a
        // downgraded workspace can still disconnect.
        yield* entitlementPolicy.canUseIntegrations(input.organizationId);
        return yield* service.connectStart(input);
      }).pipe(
        authorize(input.organizationId),
        withRemapDbErrors("Integration", "select")
      ),
    DisconnectGitHubConnection: (
      input: Parameters<typeof service.disconnect>[0]
    ) => service.disconnect(input).pipe(authorize(input.organizationId)),
    ListGitHubRepositories: (
      input: Parameters<typeof service.listRepositories>[0]
    ) => service.listRepositories(input).pipe(authorize(input.organizationId)),
    GetGitHubSettings: (input: Parameters<typeof service.getSettings>[0]) =>
      service.getSettings(input).pipe(authorize(input.organizationId)),
    UpdateGitHubSettings: (
      input: Parameters<typeof service.updateSettings>[0]
    ) => service.updateSettings(input).pipe(authorize(input.organizationId)),
    ListGitHubRules: (input: Parameters<typeof service.listRules>[0]) =>
      service.listRules(input).pipe(authorize(input.organizationId)),
    CreateGitHubRule: (input: Parameters<typeof service.createRule>[0]) =>
      service.createRule(input).pipe(authorize(input.organizationId)),
    UpdateGitHubRule: (input: Parameters<typeof service.updateRule>[0]) =>
      service.updateRule(input).pipe(authorize(input.organizationId)),
    DeleteGitHubRule: (input: Parameters<typeof service.deleteRule>[0]) =>
      service.deleteRule(input).pipe(authorize(input.organizationId)),
    CreateGitHubPostIssue: (
      input: Parameters<typeof service.createPostIssue>[0]
    ) => service.createPostIssue(input).pipe(authorize(input.organizationId)),
    LinkGitHubPostIssue: (input: Parameters<typeof service.linkPostIssue>[0]) =>
      service.linkPostIssue(input).pipe(authorize(input.organizationId)),
  };
});

/** RPC layer deliberately leaves the server-selected GitHub adapter dependency unresolved. */
export const GitHubManagementRpcHandlers = GitHubManagementRpcs.toLayer(
  GitHubManagementRpcHandlersEffect
);
