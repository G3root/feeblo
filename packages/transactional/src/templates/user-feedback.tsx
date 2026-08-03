import * as React from "react";
import { Text } from "react-email";
import { EmailShell } from "./email-shell";

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
    footerBlurb="You received this one-time lifecycle email because you created a Feeblo account."
    homeUrl="https://feeblo.com"
    preview="Tell us how your first week with Feeblo has been"
    title={`How's your first week${name ? `, ${name}` : ""}?`}
    titleLead={`You've had a little time to explore Feeblo. We'd love your input on what's working and what isn't.`}
  >
    <Text className="m-0 font-14 font-sans text-fg-2">
      We don&apos;t send long emails often. When we do, we keep them plain—no
      hero, no clutter—just a direct word from the team behind Feeblo.
    </Text>
    <Text className="m-0 mt-[18px] font-14 font-sans text-fg-2">
      What has worked well so far, and what could we make better? Your feedback
      helps us prioritize what to build next.
    </Text>
    <Text className="m-0 mt-[18px] font-14 font-sans text-fg-2">
      — The Feeblo team
    </Text>
  </EmailShell>
);

export const createUserFeedbackEmail = (props: UserFeedbackEmailProps) => ({
  subject: "How's your first week with Feeblo going?",
  react: React.createElement(UserFeedbackEmail, props),
});

UserFeedbackEmail.PreviewProps = {
  feedbackUrl: "https://feedback.feeblo.com",
  name: "Ava",
} satisfies UserFeedbackEmailProps;

export default UserFeedbackEmail;
