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
    <Text className="m-0 font-14 font-sans text-fg-2">
      Hi{name ? ` ${name}` : " there"},
    </Text>
    <Text className="m-0 mt-[18px] font-14 font-sans text-fg-2">
      I&apos;m Nafees — I built Feeblo so teams can collect feedback and act on
      it without the noise. Thanks for signing up.
    </Text>
    <Text className="m-0 mt-[18px] font-14 font-sans text-fg-2">
      Your workspace is ready whenever you are. I&apos;d genuinely love to know
      what you&apos;re hoping to get out of it, what feels good, and what
      doesn&apos;t.
    </Text>
    <Text className="m-0 mt-[18px] font-14 font-sans text-fg-2">
      If you get stuck or just want to talk, hit reply — I read every message.
    </Text>
    <Text className="m-0 mt-[18px] font-14 font-sans text-fg-2">
      — Nafees
      <br />
      Founder, Feeblo
    </Text>
    <Text className="m-0 mt-[18px] font-14 font-sans text-fg-2">
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
