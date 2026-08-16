import * as React from "react";
import { Link, Section, Text } from "react-email";
import { EmailShell } from "./email-shell";

export type EmailPost = { readonly label: string; readonly url: string };

export const EmailPostList = ({
  heading,
  posts,
}: {
  readonly heading: string;
  readonly posts: readonly EmailPost[];
}) => {
  return (
    <Section>
      <Text className="m-0 font-20 font-sans text-fg">
        {heading}
      </Text>
      {posts.map((item) => (
        <Section className="border-stroke border-t" key={item.url}>
          <Link
            className="inline-block w-full py-4 font-14 font-sans text-fg"
            href={item.url}
          >
            {item.label}
          </Link>
        </Section>
      ))}
    </Section>
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
    homeUrl="https://feeblo.com"
    preview={`Your weekly ${props.organizationName} digest`}
    title="Your weekly digest"
    titleLead={`Here is what happened in the ${props.organizationName} workspace last week.`}
    unsubscribeUrl={props.unsubscribeUrl}
  >
    <EmailPostList heading="Latest feedback" posts={props.posts} />
  </EmailShell>
);

export const createWeeklyDigestEmail = (props: WeeklyDigestEmailProps) => ({
  subject: `${props.organizationName}: weekly digest`,
  react: React.createElement(WeeklyDigestEmail, props),
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
