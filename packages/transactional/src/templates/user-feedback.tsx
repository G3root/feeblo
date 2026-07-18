import { Copy, EmailShell, Lead } from "./email-shell";

type UserFeedbackEmailProps = {
  readonly feedbackUrl: string;
  readonly name: string;
};

export const UserFeedbackEmail = ({
  feedbackUrl,
  name,
}: UserFeedbackEmailProps) => (
  <EmailShell
    cta={{ label: "Share your feedback", href: feedbackUrl }}
    eyebrow="How's Feeblo going?"
    footer="You received this one-time lifecycle email because you created a Feeblo account."
    preview="Tell us how your first week with Feeblo has been"
    title={`How's your first week${name ? `, ${name}` : ""}?`}
  >
    <Lead>
      You've had a little time to explore Feeblo. We'd love your input.
    </Lead>
    <Copy>
      What has worked well so far, and what could we make better? Your feedback
      helps us prioritize what to build next.
    </Copy>
  </EmailShell>
);

export const createUserFeedbackEmail = (props: UserFeedbackEmailProps) => ({
  subject: "How's your first week with Feeblo going?",
  react: <UserFeedbackEmail {...props} />,
});

UserFeedbackEmail.PreviewProps = {
  feedbackUrl: "https://feedback.feeblo.com",
  name: "Ava",
} satisfies UserFeedbackEmailProps;

export default UserFeedbackEmail;
