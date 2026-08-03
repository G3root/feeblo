import * as React from "react";
import { EmailShell } from "./email-shell";

import { type EmailPost, EmailPostList } from "./weekly-digest";

type NotificationEmailProps = {
  readonly actionLabel: string;
  readonly actionUrl: string;
  readonly body: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly unsubscribeUrl: string;
  readonly posts: readonly EmailPost[];
};

export const NotificationEmail = ({
  actionLabel,
  actionUrl,
  body,
  eyebrow,
  title,
  unsubscribeUrl,
  posts,
}: NotificationEmailProps) => (
  <EmailShell
    cta={{ label: actionLabel, href: actionUrl }}
    footerBlurb={
      "You received this because you enabled this notification for this workspace. You can manage all email notifications from your workspace settings."
    }
    homeUrl="https://feeblo.com"
    preview={`${eyebrow}: ${title}`}
    title={title}
    titleLead={body}
    unsubscribeUrl={unsubscribeUrl}
  >
    <EmailPostList heading="Submitted posts" posts={posts} />
  </EmailShell>
);

export const createNotificationEmail = (props: NotificationEmailProps) => ({
  subject: props.title,
  react: React.createElement(NotificationEmail, props),
});

NotificationEmail.PreviewProps = {
  actionLabel: "View dashboard",
  actionUrl: "https://app.feeblo.com/acme",
  body: "2 new posts have been submitted.",
  eyebrow: "Feedback",
  title: "New submissions in your workspace",
  unsubscribeUrl: "https://app.feeblo.com/settings/notifications",
  posts: [
    {
      label: "Add keyboard shortcuts to the dashboard",
      url: "https://app.feeblo.com/acme/post/feedback/keyboard-shortcuts",
    },
    {
      label: "Support custom fields in exports",
      url: "https://app.feeblo.com/acme/post/feedback/custom-export-fields",
    },
  ],
} satisfies NotificationEmailProps;

export default NotificationEmail;
