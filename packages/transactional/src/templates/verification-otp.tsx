import * as React from "react";
import { Section, Text } from "react-email";
import { EmailShell } from "./email-shell";

type VerificationOtpEmailProps = {
  readonly otp: string;
  readonly flowLabel: string;
};

export const VerificationOtpEmail = ({
  flowLabel,
  otp,
}: VerificationOtpEmailProps) => (
  <EmailShell
    footerBlurb="For security, never share this code with anyone."
    homeUrl="https://feeblo.com"
    preview={`Your ${flowLabel.toLowerCase()} code is ${otp}`}
    title="Almost there"
    titleLead={`Use this one-time code to finish your ${flowLabel.toLowerCase()} on Feeblo. This code will only be valid for the next few minutes.`}
  >
    <Section className="border border-stroke bg-bg-2 px-5 py-5 text-center">
      <Text className="m-0 font-11 font-sans text-fg-3">
        One-time code
      </Text>
      <Text className="m-0 mt-3 font-24 font-sans text-fg tracking-[0.24em]">
        {otp}
      </Text>
    </Section>
  </EmailShell>
);

export const createVerificationOtpEmail = (
  props: VerificationOtpEmailProps
) => ({
  subject: `Your Feeblo ${props.flowLabel.toLowerCase()} code`,
  react: React.createElement(VerificationOtpEmail, props),
});

VerificationOtpEmail.PreviewProps = {
  flowLabel: "email verification",
  otp: "226539",
} satisfies VerificationOtpEmailProps;

export default VerificationOtpEmail;
