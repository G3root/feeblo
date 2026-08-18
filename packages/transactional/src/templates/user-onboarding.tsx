import * as React from "react";
import { Link, Text } from "react-email";

import { EmailShell } from "./email-shell";

type UserOnboardingEmailProps = {
  readonly dashboardUrl: string;
  readonly name: string;
};

export const UserOnboardingEmail = ({
  dashboardUrl,
  name,
}: UserOnboardingEmailProps) => (
  <EmailShell
    footerBlurb="You received this one-time lifecycle email because you created a Feeblo account."
    homeUrl="https://feeblo.com"
    preview="Welcome to Feeblo — a personal note from Nafees"
    title="Welcome to Feeblo"
    titleSize="md"
  >
    <Text className="font-14 text-fg-2 m-0 font-sans">
      Hi{name ? ` ${name}` : " there"},
    </Text>
    <Text className="font-14 text-fg-2 m-0 mt-[18px] font-sans">
      I'm Nafees from Feeblo. Thanks for joining us!
    </Text>
    <Text className="font-14 text-fg-2 m-0 mt-[18px] font-sans">
      I'd really love to hear what you're hoping to use Feeblo for, what you
      like, what feels confusing, or anything you think we could do better.
    </Text>
    <Text className="font-14 text-fg-2 m-0 mt-[18px] font-sans">
      If you ever get stuck or just want to chat, just hit reply. I read every
      email myself.
    </Text>
    <Text className="font-14 text-fg-2 m-0 mt-[18px] font-sans">
      — Nafees
      <br />
      Founder, Feeblo
    </Text>
    <Text className="font-14 text-fg-2 m-0 mt-[18px] font-sans">
      <Link className="text-fg" href={dashboardUrl}>
        Open your workspace
      </Link>
    </Text>
  </EmailShell>
);

export const createUserOnboardingEmail = (props: UserOnboardingEmailProps) => ({
  subject: "Welcome to Feeblo",
  react: React.createElement(UserOnboardingEmail, props),
});

UserOnboardingEmail.PreviewProps = {
  dashboardUrl: "https://app.feeblo.com",
  name: "Ava",
} satisfies UserOnboardingEmailProps;

export default UserOnboardingEmail;
