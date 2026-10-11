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
  /**
   * Why the recipient got the email. Members are on by default and read a
   * membership reason; a topic subscriber reads the subscription reason.
   * Absent means a delivery written before the split, which was subscriber-only.
   */
  readonly reason?: "member" | "subscriber" | undefined;
};

export const NotificationEmail = ({
  actionLabel,
  actionUrl,
  body,
  eyebrow,
  title,
  unsubscribeUrl,
  posts,
  reason,
}: NotificationEmailProps) => (
  <EmailShell
    cta={{ label: actionLabel, href: actionUrl }}
    footerBlurb={
      reason === "member"
        ? "You received this because you're a member of this workspace. Manage all email notifications in your workspace settings."
        : "You received this because you subscribed to updates on this post. Use the Unsubscribe link below to stop these emails."
    }
    homeUrl="https://feeblo.com"
    preview={`${eyebrow}: ${title}`}
    title={title}
    titleLead={body}
    unsubscribeUrl={unsubscribeUrl}
  >
    <EmailPostList heading="Posts" posts={posts} />
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
  unsubscribeUrl: "https://app.feeblo.com/org_acme/settings/notifications",
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
