import { Copy, EmailShell, Lead } from "./email-shell";

type DigestItem = { readonly label: string; readonly url: string };

type DigestSectionProps = {
  readonly title: string;
  readonly total: number;
  readonly items: readonly DigestItem[];
  readonly moreUrl: string;
};

const DigestSection = ({
  title,
  total,
  items,
  moreUrl,
}: DigestSectionProps) => {
  if (total === 0) {
    return null;
  }
  const more = Math.max(0, total - items.length);
  return (
    <div style={{ marginTop: "24px" }}>
      <Copy>
        <strong>
          {title} ({total})
        </strong>
      </Copy>
      <ul>
        {items.map((item) => (
          <li key={item.url}>
            <a href={item.url}>{item.label}</a>
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <Copy>
          <a href={moreUrl}>{more} more</a>
        </Copy>
      ) : null}
    </div>
  );
};

type WeeklyDigestEmailProps = {
  readonly organizationName: string;
  readonly dashboardUrl: string;
  readonly unsubscribeUrl: string;
  readonly followed: DigestSectionProps;
  readonly submissions: DigestSectionProps;
  readonly changelogs: DigestSectionProps;
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
    <DigestSection {...props.followed} />
    <DigestSection {...props.submissions} />
    <DigestSection {...props.changelogs} />
  </EmailShell>
);

export const createWeeklyDigestEmail = (props: WeeklyDigestEmailProps) => ({
  subject: `${props.organizationName}: weekly digest`,
  react: <WeeklyDigestEmail {...props} />,
});
