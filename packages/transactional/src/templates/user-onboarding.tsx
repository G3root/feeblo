import { Copy, EmailShell, Lead } from "./email-shell";

type UserOnboardingEmailProps = {
  readonly dashboardUrl: string;
  readonly name: string;
};

export const UserOnboardingEmail = ({
  dashboardUrl,
  name,
}: UserOnboardingEmailProps) => (
  <EmailShell
    cta={{ label: "Open your dashboard", href: dashboardUrl }}
    eyebrow="Welcome to Feeblo"
    footer={
      <>
        You received this one-time lifecycle email because you created a Feeblo
        account.
      </>
    }
    preview="A quick guide to getting started with Feeblo"
    title={`Welcome to Feeblo${name ? `, ${name}` : ""}`}
  >
    <Lead>Your workspace is ready. Start by opening your dashboard.</Lead>
    <Copy>
      From there you can create a feedback board, publish a changelog, and
      invite your team.
    </Copy>
  </EmailShell>
);

export const createUserOnboardingEmail = (props: UserOnboardingEmailProps) => ({
  subject: "Welcome to Feeblo",
  react: <UserOnboardingEmail {...props} />,
});
