import "../../tailwind.css";
import type { TContactSearchResult } from "@feeblo/domain/contact/schema";
import { useState } from "react";

import type { ContactComboboxSelection } from "../contact-combobox/contact-combobox";
import type { ContactSearchFn } from "../contact-combobox/contact-combobox";
import { AuthorPicker } from "./author-picker";

const member: TContactSearchResult = {
  alreadyVoted: false,
  avatarUrl: null,
  companyName: null,
  contactId: "contact-member",
  email: "sarah@feeblo.com",
  hasAccess: true,
  isMember: true,
  name: "Sarah Chen",
  userId: "user-member",
};

const customer: TContactSearchResult = {
  alreadyVoted: false,
  avatarUrl: null,
  companyName: "Acme Inc",
  contactId: "contact-acme",
  email: "john@acme.com",
  hasAccess: true,
  isMember: false,
  name: "John Doe",
  userId: "user-shadow",
};

function fixtureSearch(...fixtures: TContactSearchResult[]): ContactSearchFn {
  return ({ query }) =>
    Promise.resolve(
      fixtures.filter((contact) => {
        const haystack =
          `${contact.name ?? ""} ${contact.email ?? ""}`.toLowerCase();
        return haystack.includes(query.toLowerCase());
      })
    );
}

export default {
  title: "V2 / AuthorPicker",
};

export function Unassigned() {
  const [selection, setSelection] = useState<ContactComboboxSelection | null>(
    null
  );

  return (
    <div className="bg-background flex min-h-screen items-start justify-center p-8">
      <div className="w-64">
        <AuthorPicker
          label="Post on behalf of"
          onSelect={setSelection}
          organizationId="organization-id"
          placeholder="Select a customer"
          search={fixtureSearch(member, customer)}
          searchPlaceholder="Search customers by name or email..."
          submitLabel="Create & add author"
          value={selection}
        />
      </div>
    </div>
  );
}

export function Assigned() {
  const [selection, setSelection] = useState<ContactComboboxSelection | null>({
    contactId: customer.contactId ?? undefined,
    email: customer.email ?? undefined,
    hasAccess: true,
    isMember: false,
    name: customer.name ?? undefined,
    userId: customer.userId ?? undefined,
  });

  return (
    <div className="bg-background flex min-h-screen items-start justify-center p-8">
      <div className="w-64">
        <AuthorPicker
          label="Change author"
          onSelect={setSelection}
          organizationId="organization-id"
          search={fixtureSearch(member, customer)}
          value={selection}
        />
      </div>
    </div>
  );
}

export function StoredAuthor() {
  return (
    <div className="bg-background flex min-h-screen items-start justify-center p-8">
      <div className="w-64 space-y-4">
        <AuthorPicker
          disabled
          display={{ name: "John Doe", avatarUrl: null }}
          label="Change author"
          onSelect={() => {}}
          organizationId="organization-id"
          value={null}
        />
        <p className="text-muted-foreground text-xs">
          Read-only rendering for roles without the update permission (or locked
          posts); the picker's search state stays unselected.
        </p>
      </div>
    </div>
  );
}
