import { describe, expect, it } from "vitest";

import {
  type OnBehalfContact,
  type OnBehalfMember,
  resolveOnBehalfSubject,
} from "./on-behalf-subject";

const NO_CONTACTS = new Map<string, OnBehalfContact>();
const NO_MEMBERS = new Map<string, OnBehalfMember>();

const contact = (id: string, name: string | null, email: string | null) =>
  new Map([[id, { email, name }]]);

const member = (userId: string, name: string) =>
  new Map([[userId, { user: { name } }]]);

describe("resolveOnBehalfSubject", () => {
  it("prefers the live contact so a CRM rename reaches old entries", () => {
    expect(
      resolveOnBehalfSubject(
        {
          onBehalfOf: {
            contactId: "cnt_1",
            kind: "customer",
            name: "Old Name",
          },
        },
        contact("cnt_1", "New Name", "jane@acme.com"),
        NO_CONTACTS,
        NO_MEMBERS
      )
    ).toEqual({ isMember: false, name: "New Name" });
  });

  it("falls back to the snapshot once the contact is deleted", () => {
    expect(
      resolveOnBehalfSubject(
        {
          onBehalfOf: {
            contactId: "cnt_gone",
            email: "jane@acme.com",
            kind: "customer",
            name: "Jane Doe",
          },
        },
        NO_CONTACTS,
        NO_CONTACTS,
        NO_MEMBERS
      )
    ).toEqual({ isMember: false, name: "Jane Doe" });
  });

  it("falls back to the snapshot email when no name was captured", () => {
    expect(
      resolveOnBehalfSubject(
        {
          onBehalfOf: {
            contactId: "cnt_gone",
            email: "jane@acme.com",
            kind: "customer",
          },
        },
        NO_CONTACTS,
        NO_CONTACTS,
        NO_MEMBERS
      )
    ).toEqual({ isMember: false, name: "jane@acme.com" });
  });

  it("keeps a removed staff member labelled as staff", () => {
    expect(
      resolveOnBehalfSubject(
        {
          onBehalfOf: {
            kind: "member",
            name: "Bob Staff",
            userId: "usr_gone",
          },
        },
        NO_CONTACTS,
        NO_CONTACTS,
        NO_MEMBERS
      )
    ).toEqual({ isMember: true, name: "Bob Staff" });
  });

  it("still resolves a live member from the member list", () => {
    expect(
      resolveOnBehalfSubject(
        { onBehalfOf: { kind: "member", userId: "usr_1" } },
        NO_CONTACTS,
        NO_CONTACTS,
        member("usr_1", "Bob Staff")
      )
    ).toEqual({ isMember: true, name: "Bob Staff" });
  });

  it("reads a legacy identifier-only row as a customer", () => {
    expect(
      resolveOnBehalfSubject(
        { onBehalfOf: { contactId: "cnt_gone", userId: "usr_gone" } },
        NO_CONTACTS,
        NO_CONTACTS,
        NO_MEMBERS
      )
    ).toEqual({ isMember: false, name: "a customer" });
  });
});
