import { Column, Row, Section, Text } from "@react-email/components";
import { Copy, EmailShell, Lead } from "./email-shell";

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
    eyebrow="Workspace Invitation"
    footer="If this invitation was unexpected, you can ignore it without affecting your account."
    preview={`You’ve been invited to join ${organizationName} on Feeblo`}
    title={`Join ${organizationName}`}
  >
    <Lead>
      {inviterName ? `${inviterName} invited you` : "You’ve been invited"} to
      join <strong>{organizationName}</strong> on Feeblo.
    </Lead>
    <Copy>
      Accept the invitation to get access to boards, feedback, and team settings
      for this workspace.
    </Copy>
    <Section className="rounded bg-[#f1f3f5] px-4 py-3">
      <Row>
        <Column className="w-1/2 pr-2">
          <Text className="m-0 font-medium text-[#7b8494] text-[11px] uppercase leading-[16px] tracking-[0.16em]">
            Role
          </Text>
          <Text className="mt-[6px] mb-0 text-[#3c4149] text-[14px] leading-[20px]">
            {role}
          </Text>
        </Column>
        <Column className="w-1/2 pl-2">
          <Text className="m-0 font-medium text-[#7b8494] text-[11px] uppercase leading-[16px] tracking-[0.16em]">
            Workspace
          </Text>
          <Text className="mt-[6px] mb-0 text-[#3c4149] text-[14px] leading-[20px]">
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
  react: <OrganizationInvitationEmail {...props} />,
});

OrganizationInvitationEmail.PreviewProps = {
  inviteUrl: "https://feeblo.com/invitation/example",
  inviterName: "Ava",
  organizationName: "Feeblo",
  role: "Admin",
} satisfies OrganizationInvitationEmailProps;

export default OrganizationInvitationEmail;
