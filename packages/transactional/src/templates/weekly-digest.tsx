import { Copy, EmailShell, Lead } from "./email-shell";

export type EmailPost = { readonly label: string; readonly url: string };

export const EmailPostList = ({
  heading,
  posts,
}: {
  readonly heading: string;
  readonly posts: readonly EmailPost[];
}) => {
  return (
    <div style={{ marginTop: "24px" }}>
      <Copy>
        <strong>{heading}</strong>
      </Copy>
      <ul>
        {posts.map((item) => (
          <li key={item.url}>
            <a href={item.url}>{item.label}</a>
          </li>
        ))}
      </ul>
    </div>
  );
};

type WeeklyDigestEmailProps = {
  readonly organizationName: string;
  readonly dashboardUrl: string;
  readonly unsubscribeUrl: string;
  readonly posts: readonly EmailPost[];
};

export const WeeklyDigestEmail = (props: WeeklyDigestEmailProps) => (
  <EmailShell
    cta={{ label: "Open workspace", href: props.dashboardUrl }}
    eyebrow={props.organizationName}
    footer={
      <>
        You receive this because you follow feedback in this workspace.{" "}
        <a href={props.unsubscribeUrl}>Unsubscribe from this weekly digest</a>.
      </>
    }
    preview={`Your weekly ${props.organizationName} digest`}
    title="Your weekly digest"
  >
    <Lead>Here is what happened in the workspace last week.</Lead>
    <EmailPostList heading="Latest feedback" posts={props.posts} />
  </EmailShell>
);

export const createWeeklyDigestEmail = (props: WeeklyDigestEmailProps) => ({
  subject: `${props.organizationName}: weekly digest`,
  react: <WeeklyDigestEmail {...props} />,
});

WeeklyDigestEmail.PreviewProps = {
  organizationName: "Acme",
  dashboardUrl: "https://app.feeblo.com/acme",
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
} satisfies WeeklyDigestEmailProps;

export default WeeklyDigestEmail;
