/** GitHub rejects issue bodies longer than 65,536 characters. */
export const GITHUB_ISSUE_BODY_CHARACTER_LIMIT = 65_536;

const truncationMarker = (postUrl: string | undefined): string =>
  postUrl === undefined
    ? "\n\n…[Truncated — view the full post on Feeblo]"
    : `\n\n…[View the full post on Feeblo](${postUrl})`;

/** Renders the issue body from the Feeblo post description; the Feeblo backlink lives in the bot comment, not the body. */
export const renderGitHubIssueBody = ({
  description,
  postUrl,
}: {
  readonly description?: string | null;
  readonly postUrl?: string;
}): string => {
  const body = description?.trim();
  if (body === undefined || body.length === 0) {
    return "This issue was created from Feeblo feedback.";
  }
  if (body.length <= GITHUB_ISSUE_BODY_CHARACTER_LIMIT) {
    return body;
  }
  const marker = truncationMarker(postUrl);
  const truncatedLength = GITHUB_ISSUE_BODY_CHARACTER_LIMIT - marker.length;
  return `${body.slice(0, Math.max(0, truncatedLength))}${marker}`;
};

/** Renders the issue title from the Feeblo post title; empty titles fall back to a stable label. */
export const renderGitHubIssueTitle = ({
  title,
}: {
  readonly title?: string | null;
}): string => {
  const trimmed = title?.trim();
  return trimmed !== undefined && trimmed.length > 0
    ? trimmed
    : "Feeblo feedback";
};
