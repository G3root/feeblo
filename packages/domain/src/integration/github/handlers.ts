import * as Effect from "effect/Effect";
import * as Policy from "../../policy";
import { GitHubManagementService } from "./management-service";
import { GitHubManagementRpcs } from "./rpcs";

/** RPC handlers authorize GitHub management before delegating provider-specific work to the application service. */
export const GitHubManagementRpcHandlersEffect = Effect.gen(function* () {
  const service = yield* GitHubManagementService;
  const authorize = (organizationId: string) =>
    Policy.withPolicy(
      Policy.canPermission(organizationId, "integrations.manage")
    );
  return {
    GitHubIntegrationStatus: () => service.status(),
    GitHubConnectionList: (
      input: Parameters<typeof service.listConnections>[0]
    ) => service.listConnections(input).pipe(authorize(input.organizationId)),
    GitHubConnectStart: (input: Parameters<typeof service.connectStart>[0]) =>
      service.connectStart(input).pipe(authorize(input.organizationId)),
    GitHubConnectionDisconnect: (
      input: Parameters<typeof service.disconnect>[0]
    ) => service.disconnect(input).pipe(authorize(input.organizationId)),
    GitHubRepositoryList: (
      input: Parameters<typeof service.listRepositories>[0]
    ) => service.listRepositories(input).pipe(authorize(input.organizationId)),
    GitHubSettingsGet: (input: Parameters<typeof service.getSettings>[0]) =>
      service.getSettings(input).pipe(authorize(input.organizationId)),
    GitHubSettingsUpdate: (
      input: Parameters<typeof service.updateSettings>[0]
    ) => service.updateSettings(input).pipe(authorize(input.organizationId)),
    GitHubRuleList: (input: Parameters<typeof service.listRules>[0]) =>
      service.listRules(input).pipe(authorize(input.organizationId)),
    GitHubRuleCreate: (input: Parameters<typeof service.createRule>[0]) =>
      service.createRule(input).pipe(authorize(input.organizationId)),
    GitHubRuleUpdate: (input: Parameters<typeof service.updateRule>[0]) =>
      service.updateRule(input).pipe(authorize(input.organizationId)),
    GitHubRuleDelete: (input: Parameters<typeof service.deleteRule>[0]) =>
      service.deleteRule(input).pipe(authorize(input.organizationId)),
    GitHubPostIssueCreate: (
      input: Parameters<typeof service.createPostIssue>[0]
    ) => service.createPostIssue(input).pipe(authorize(input.organizationId)),
    GitHubPostIssueLink: (input: Parameters<typeof service.linkPostIssue>[0]) =>
      service.linkPostIssue(input).pipe(authorize(input.organizationId)),
  };
});

/** RPC layer deliberately leaves the server-selected GitHub adapter dependency unresolved. */
export const GitHubManagementRpcHandlers = GitHubManagementRpcs.toLayer(
  GitHubManagementRpcHandlersEffect
);
