import * as React from "react";
import { Section, Text } from "react-email";

import { EmailShell } from "./email-shell";

/** Properties for the manual email subscription double-opt-in message. */
export interface EmailSubscriptionVerificationProps {
  readonly verificationUrl: string;
}

/** Renders the single-purpose link used to verify a manual email subscription. */
export const EmailSubscriptionVerification = ({
  verificationUrl,
}: EmailSubscriptionVerificationProps) => (
  <EmailShell
    cta={{ label: "Verify subscription", href: verificationUrl }}
    footerBlurb="You received this because this address requested email updates. Ignore this message if you did not make the request."
    homeUrl="https://feeblo.com"
    preview="Verify your Feeblo email subscription"
    title="Verify your email subscription"
    titleLead="Confirm this address before Feeblo sends workspace updates."
  >
    <Section className="border-stroke bg-bg-2 border px-4 py-3">
      <Text className="font-13 text-fg-2 m-0 font-sans break-all">
        {verificationUrl}
      </Text>
    </Section>
  </EmailShell>
);

/** Creates the provider-neutral verification email request. */
export const createEmailSubscriptionVerificationEmail = (
  props: EmailSubscriptionVerificationProps
) => ({
  subject: "Verify your Feeblo email subscription",
  react: React.createElement(EmailSubscriptionVerification, props),
});

EmailSubscriptionVerification.PreviewProps = {
  verificationUrl:
    "https://app.feeblo.com/email-subscriptions/verify?token=preview",
} satisfies EmailSubscriptionVerificationProps;

export default EmailSubscriptionVerification;
