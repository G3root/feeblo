import * as React from "react";
import { Link, Section, Text } from "react-email";
import { EmailShell } from "./email-shell";

export type PostStatusChange = {
  readonly previousStatusLabel: string;
  readonly nextStatusLabel: string;
};

type PostStatusChangedEmailProps = {
  readonly postTitle: string;
  readonly postUrl: string;
  readonly changes: readonly PostStatusChange[];
  readonly unsubscribeUrl: string;
};

const formatChange = (change: PostStatusChange) =>
  `${change.previousStatusLabel} → ${change.nextStatusLabel}`;

export const PostStatusChangedEmail = ({
  changes,
  postTitle,
  postUrl,
  unsubscribeUrl,
}: PostStatusChangedEmailProps) => {
  const latest = changes.at(-1);
  return (
    <EmailShell
      cta={{ label: "View feedback", href: postUrl }}
      footerBlurb="You received this because you're subscribed to this feedback post. You can unsubscribe from this post at any time."
      homeUrl="https://feeblo.com"
      preview={`Status updated: ${latest ? formatChange(latest) : ""}`}
      title="Feedback status updated"
      titleLead={`"${postTitle}" moved to ${latest?.nextStatusLabel ?? "a new status"}.`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Section>
        {changes.length === 1 ? (
          <Text className="m-0 font-14 font-sans text-fg-2">
            The status of this post was updated to{" "}
            <strong className="text-fg">{latest?.nextStatusLabel ?? ""}</strong>
            .
          </Text>
        ) : (
          <>
            <Text className="m-0 font-14 font-sans text-fg-2">
              This post changed status {changes.length} times:
            </Text>
            {changes.map((change, index) => (
              <Text
                className="m-0 mt-[8px] font-14 font-sans text-fg-2"
                key={`${index}-${change.nextStatusLabel}`}
              >
                {index + 1}. {formatChange(change)}
              </Text>
            ))}
          </>
        )}
        <Text className="m-0 mt-[18px] font-14 font-sans text-fg-2">
          <Link className="text-fg" href={postUrl}>
            Open feedback
          </Link>
        </Text>
      </Section>
    </EmailShell>
  );
};

export const createPostStatusChangedEmail = (
  props: PostStatusChangedEmailProps
) => ({
  subject: `Status updated: ${props.postTitle}`,
  react: React.createElement(PostStatusChangedEmail, props),
});

PostStatusChangedEmail.PreviewProps = {
  postTitle: "Add keyboard shortcuts to the dashboard",
  postUrl: "https://app.feeblo.com/acme/post/feedback/keyboard-shortcuts",
  changes: [{ previousStatusLabel: "Planned", nextStatusLabel: "In progress" }],
  unsubscribeUrl: "https://app.feeblo.com/settings/notifications",
} satisfies PostStatusChangedEmailProps;

export default PostStatusChangedEmail;
