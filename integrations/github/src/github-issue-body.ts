/** Renders the issue body while retaining the canonical Feeblo feedback URL. */
export const renderGitHubIssueBody = ({
  postUrl,
}: {
  readonly postUrl: URL;
}): string =>
  [
    "This issue was created from Feeblo feedback.",
    "",
    `Continue the feedback discussion in Feeblo: ${postUrl.href}`,
  ].join("\n");
