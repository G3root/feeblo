import { Section, Text } from "@react-email/components";
import { Copy, EmailShell, Lead } from "./email-shell";

type VerificationOtpEmailProps = {
  readonly otp: string;
  readonly flowLabel: string;
};

export const VerificationOtpEmail = ({
  flowLabel,
  otp,
}: VerificationOtpEmailProps) => (
  <EmailShell
    eyebrow="Verification Code"
    footer="For security, never share this code with anyone."
    preview={`Your ${flowLabel.toLowerCase()} code is ${otp}`}
    title={`${flowLabel} code`}
  >
    <Lead>
      Use this one-time code to finish your Feeblo {flowLabel.toLowerCase()}.
    </Lead>
    <Copy>
      This code will only be valid for the next few minutes. If you didn’t
      request it, you can ignore this email.
    </Copy>
    <Section>
      <Text className="m-0 font-medium text-[#7b8494] text-[11px] uppercase leading-[16px] tracking-[0.16em]">
        One-time password
      </Text>
      <Text
        className="mt-[10px] inline-block rounded bg-[#dfe1e4] px-1 py-px font-bold font-mono text-[#3c4149] text-[21px] leading-[1.4] tracking-[-0.3px]"
        style={{
          fontFamily:
            "'SFMono-Regular', 'SF Mono', 'Roboto Mono', 'Menlo', monospace",
        }}
      >
        {otp}
      </Text>
    </Section>
  </EmailShell>
);

export const createVerificationOtpEmail = (
  props: VerificationOtpEmailProps
) => ({
  subject: `Your Feeblo ${props.flowLabel.toLowerCase()} code`,
  react: <VerificationOtpEmail {...props} />,
});

VerificationOtpEmail.PreviewProps = {
  flowLabel: "email verification",
  otp: "226539",
} satisfies VerificationOtpEmailProps;

export default VerificationOtpEmail;
