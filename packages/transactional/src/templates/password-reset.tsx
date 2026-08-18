import * as React from "react";
import { Section, Text } from "react-email";

import { EmailShell } from "./email-shell";

type PasswordResetEmailProps = {
  readonly resetUrl: string;
  readonly recipientName?: string | null;
};

export const PasswordResetEmail = ({
  recipientName,
  resetUrl,
}: PasswordResetEmailProps) => (
  <EmailShell
    cta={{ label: "Create new password", href: resetUrl }}
    footerBlurb="If you didn't request this change, you can safely ignore this message."
    homeUrl="https://feeblo.com"
    preview="Reset your Feeblo password"
    title="Password reset"
    titleLead={`${recipientName ? `Hi ${recipientName},` : "Hi,"} we received a request to reset your password for Feeblo. If you didn't request a reset, you can safely ignore this email.`}
  >
    <Section className="border-stroke bg-bg-2 border px-4 py-3">
      <Text className="font-11 text-fg-3 m-0 font-sans">Reset link</Text>
      <Text className="font-13 text-fg-2 mt-2 mb-0 font-sans break-all">
        {resetUrl}
      </Text>
    </Section>
  </EmailShell>
);

export const createPasswordResetEmail = (props: PasswordResetEmailProps) => ({
  subject: "Reset your Feeblo password",
  react: React.createElement(PasswordResetEmail, props),
});

PasswordResetEmail.PreviewProps = {
  recipientName: "Ava",
  resetUrl: "https://feeblo.com/reset-password?token=example",
} satisfies PasswordResetEmailProps;

export default PasswordResetEmail;
