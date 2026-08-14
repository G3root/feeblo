/** Renders the issue body from the Feeblo post description; the Feeblo backlink lives in the bot comment, not the body. */
export const renderGitHubIssueBody = ({
  description,
}: {
  readonly description?: string | null;
}): string => {
  const body = description?.trim();
  return body !== undefined && body.length > 0
    ? body
    : "This issue was created from Feeblo feedback.";
};
