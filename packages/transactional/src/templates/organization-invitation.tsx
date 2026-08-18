import * as React from "react";
import { Column, Row, Section, Text } from "react-email";

import { EmailShell } from "./email-shell";

type OrganizationInvitationEmailProps = {
  readonly inviteUrl: string;
  readonly organizationName: string;
  readonly inviterName?: string | null;
  readonly role: string;
};

export const OrganizationInvitationEmail = ({
  inviteUrl,
  inviterName,
  organizationName,
  role,
}: OrganizationInvitationEmailProps) => (
  <EmailShell
    cta={{ label: "Accept invitation", href: inviteUrl }}
    footerBlurb="If this invitation was unexpected, you can ignore it without affecting your account."
    homeUrl="https://feeblo.com"
    preview={`You've been invited to join ${organizationName} on Feeblo`}
    title="You're invited"
    titleLead={`${inviterName ? `${inviterName} invited you` : "You've been invited"} to join ${organizationName} on Feeblo. Accept the invitation to get access to boards, feedback, and team settings for this workspace.`}
  >
    <Section className="border-stroke bg-bg-2 border px-5 py-4">
      <Row>
        <Column className="w-1/2 pr-2">
          <Text className="font-11 text-fg-3 m-0 font-sans">Role</Text>
          <Text className="font-15 text-fg mt-2 mb-0 font-sans">{role}</Text>
        </Column>
        <Column className="w-1/2 pl-2">
          <Text className="font-11 text-fg-3 m-0 font-sans">Workspace</Text>
          <Text className="font-15 text-fg mt-2 mb-0 font-sans">
            {organizationName}
          </Text>
        </Column>
      </Row>
    </Section>
  </EmailShell>
);

export const createOrganizationInvitationEmail = (
  props: OrganizationInvitationEmailProps
) => ({
  subject: `Join ${props.organizationName} on Feeblo`,
  react: React.createElement(OrganizationInvitationEmail, props),
});

OrganizationInvitationEmail.PreviewProps = {
  inviteUrl: "https://feeblo.com/invitation/example",
  inviterName: "Ava",
  organizationName: "Feeblo",
  role: "Admin",
} satisfies OrganizationInvitationEmailProps;

export default OrganizationInvitationEmail;
