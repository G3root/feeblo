import { Section, Text } from "@react-email/components";
import { Copy, EmailShell, Lead } from "./email-shell";

type PasswordResetEmailProps = {
  readonly resetUrl: string;
  readonly recipientName?: string | null;
};

export const PasswordResetEmail = ({
  recipientName,
  resetUrl,
}: PasswordResetEmailProps) => (
  <EmailShell
    cta={{ label: "Choose a new password", href: resetUrl }}
    eyebrow="Account Recovery"
    footer="If you didn’t request this change, you can safely ignore this message."
    preview="Reset your Feeblo password"
    title="Reset your password"
  >
    <Lead>
      {recipientName ? `Hi ${recipientName},` : "Hi,"} a password reset was
      requested for your Feeblo account.
    </Lead>
    <Copy>
      This link will only be valid for a limited time. If the button does not
      work, use the reset link directly:
    </Copy>
    <Section className="rounded bg-[#f1f3f5] px-3 py-2">
      <Text className="m-0 font-medium text-[#7b8494] text-[11px] uppercase leading-[16px] tracking-[0.16em]">
        Reset link
      </Text>
      <Text className="mt-[6px] mb-0 break-all text-[#3c4149] text-[13px] leading-[20px]">
        {resetUrl}
      </Text>
    </Section>
  </EmailShell>
);

export const createPasswordResetEmail = (props: PasswordResetEmailProps) => ({
  subject: "Reset your Feeblo password",
  react: <PasswordResetEmail {...props} />,
});

PasswordResetEmail.PreviewProps = {
  recipientName: "Ava",
  resetUrl: "https://feeblo.com/reset-password?token=example",
} satisfies PasswordResetEmailProps;

export default PasswordResetEmail;
