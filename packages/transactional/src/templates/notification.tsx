import { Copy, EmailShell, Lead } from "./email-shell";

type NotificationEmailProps = {
  readonly actionLabel: string;
  readonly actionUrl: string;
  readonly body: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly unsubscribeUrl: string;
};

export const NotificationEmail = ({
  actionLabel,
  actionUrl,
  body,
  eyebrow,
  title,
  unsubscribeUrl,
}: NotificationEmailProps) => (
  <EmailShell
    cta={{ label: actionLabel, href: actionUrl }}
    eyebrow={eyebrow}
    footer={
      <>
        You received this because you enabled this notification for this
        workspace. <a href={unsubscribeUrl}>Unsubscribe from this category</a>.
      </>
    }
    preview={title}
    title={title}
  >
    <Lead>{body}</Lead>
    <Copy>
      You can manage all email notifications from your workspace settings.
    </Copy>
  </EmailShell>
);

export const createNotificationEmail = (props: NotificationEmailProps) => ({
  subject: props.title,
  react: <NotificationEmail {...props} />,
});
