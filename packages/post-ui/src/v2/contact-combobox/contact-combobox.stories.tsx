import "../../tailwind.css";
import type { TContactSearchResult } from "@feeblo/domain/contact/schema";
import { useState } from "react";

import {
  ContactCombobox,
  type ContactComboboxSelection,
  type ContactSearchFn,
} from "./contact-combobox";

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

const deferredCustomer: TContactSearchResult = {
  ...customer,
  contactId: "contact-deferred",
  email: "jane@acme.com",
  hasAccess: false,
  name: "Jane Roe",
  userId: null,
};

const votedCustomer: TContactSearchResult = {
  ...customer,
  alreadyVoted: true,
  contactId: "contact-voted",
  email: "voter@acme.com",
  name: "Al Ready",
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
  title: "V2 / ContactCombobox",
};

export function Default() {
  const [selection, setSelection] = useState<ContactComboboxSelection | null>(
    null
  );

  return (
    <div className="bg-background flex min-h-screen items-start justify-center p-8">
      <div className="w-96">
        <ContactCombobox
          label="Search customers"
          onSelect={setSelection}
          organizationId="organization-id"
          search={fixtureSearch(member, customer, deferredCustomer)}
          value={selection}
        />
      </div>
    </div>
  );
}

export function AlreadyVoted() {
  const [selection, setSelection] = useState<ContactComboboxSelection | null>(
    null
  );

  return (
    <div className="bg-background flex min-h-screen items-start justify-center p-8">
      <div className="w-96">
        <ContactCombobox
          label="Add voter"
          onSelect={setSelection}
          organizationId="organization-id"
          postId="post-1"
          search={fixtureSearch(votedCustomer)}
          value={selection}
        />
      </div>
    </div>
  );
}

export function NoAccessHint() {
  const [selection, setSelection] = useState<ContactComboboxSelection | null>(
    null
  );

  return (
    <div className="bg-background flex min-h-screen items-start justify-center p-8">
      <div className="w-96 space-y-4">
        <ContactCombobox
          label="Search customers"
          onSelect={setSelection}
          organizationId="organization-id"
          search={fixtureSearch(deferredCustomer)}
          value={selection}
        />
        <p className="text-muted-foreground text-xs">
          Pick a subject to see the selected summary and the notification hint.
        </p>
      </div>
    </div>
  );
}

export function EmptyQueryCreatesCustomer() {
  const [selection, setSelection] = useState<ContactComboboxSelection | null>(
    null
  );

  return (
    <div className="bg-background flex min-h-screen items-start justify-center p-8">
      <div className="w-96">
        <ContactCombobox
          label="Search customers"
          onSelect={setSelection}
          organizationId="organization-id"
          search={fixtureSearch()}
          value={selection}
        />
      </div>
    </div>
  );
}

export function Selected() {
  const [selection, setSelection] = useState<ContactComboboxSelection | null>({
    contactId: customer.contactId,
    email: customer.email ?? undefined,
    hasAccess: true,
    isMember: false,
    name: customer.name ?? undefined,
    userId: customer.userId ?? undefined,
  });

  return (
    <div className="bg-background flex min-h-screen items-start justify-center p-8">
      <div className="w-96">
        <ContactCombobox
          label="Search customers"
          onSelect={setSelection}
          organizationId="organization-id"
          search={fixtureSearch(customer)}
          value={selection}
        />
      </div>
    </div>
  );
}
