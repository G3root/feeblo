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
    <Section className="border border-stroke bg-bg-2 px-5 py-4">
      <Row>
        <Column className="w-1/2 pr-2">
          <Text className="m-0 font-11 font-sans text-fg-3">Role</Text>
          <Text className="mt-2 mb-0 font-15 font-sans text-fg">{role}</Text>
        </Column>
        <Column className="w-1/2 pl-2">
          <Text className="m-0 font-11 font-sans text-fg-3">Workspace</Text>
          <Text className="mt-2 mb-0 font-15 font-sans text-fg">
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
