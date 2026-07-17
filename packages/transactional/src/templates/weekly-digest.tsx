import { Copy, EmailShell, Lead } from "./email-shell";

type DigestItem = { readonly label: string; readonly url: string };

const DigestPosts = ({ posts }: { readonly posts: readonly DigestItem[] }) => {
  return (
    <div style={{ marginTop: "24px" }}>
      <Copy>
        <strong>Latest feedback</strong>
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
  readonly posts: readonly DigestItem[];
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
    <DigestPosts posts={props.posts} />
  </EmailShell>
);

export const createWeeklyDigestEmail = (props: WeeklyDigestEmailProps) => ({
  subject: `${props.organizationName}: weekly digest`,
  react: <WeeklyDigestEmail {...props} />,
});
