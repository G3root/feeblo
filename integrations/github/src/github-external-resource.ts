import {
  type IntegrationExternalResourceDraft,
  IntegrationExternalResourceType,
} from "@feeblo/integration-core";

/**
 * Provider-normalized GitHub issue identity shared by the delivery worker and
 * the user-requested create/link paths. One mapping keeps the persisted
 * `displayKey`, `safeMetadata`, and `title` identical no matter which path
 * recorded the issue.
 */
export const makeGitHubIssueExternalResourceDraft = ({
  issueNumber,
  postId,
  repositoryName,
  repositoryOwner,
  remoteId,
  remoteUrl,
  state,
  title,
}: {
  readonly issueNumber: number;
  readonly postId: IntegrationExternalResourceDraft["postId"];
  readonly repositoryName: string;
  readonly repositoryOwner: string;
  readonly remoteId: string;
  readonly remoteUrl: URL;
  readonly state: "open" | "closed";
  readonly title: string;
}): IntegrationExternalResourceDraft => ({
  displayKey: `${repositoryOwner}/${repositoryName}#${issueNumber}`,
  postId,
  remoteId,
  stateKey: state,
  remoteUrl,
  resourceType: IntegrationExternalResourceType.make("issue"),
  safeMetadata: {
    issueNumber,
    repositoryName,
    repositoryOwner,
  },
  title,
});
