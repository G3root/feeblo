import type { TContactSearchResult } from "@feeblo/domain/contact/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import {
  ContactCombobox,
  type ContactComboboxSelection,
  type ContactSearchFn,
} from "./contact-combobox";

// The component imports the runtime transport transitively; the tests inject
// their own `search` implementation, so the real module (which reads Node
// globals) is stubbed out of the browser bundle.
// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("@feeblo/web-shared/runtime", () => ({
  fetchRpc: () => Promise.resolve([]),
}));

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

const voter: TContactSearchResult = {
  alreadyVoted: true,
  avatarUrl: null,
  companyName: "Acme Inc",
  contactId: "contact-voter",
  email: "voter@acme.com",
  hasAccess: true,
  isMember: false,
  name: "Al Ready",
  userId: "user-voter",
};

const deferred: TContactSearchResult = {
  alreadyVoted: false,
  avatarUrl: null,
  companyName: "Acme Inc",
  contactId: "contact-deferred",
  email: "jane@acme.com",
  hasAccess: false,
  isMember: false,
  name: "Jane Roe",
  userId: null,
};

type SelectionHandler = (selection: ContactComboboxSelection | null) => void;

function Harness({
  onSearch,
  onSelect,
}: {
  onSearch: ContactSearchFn;
  onSelect: SelectionHandler;
}) {
  return (
    <ContactCombobox
      label="Search customers"
      onSelect={onSelect}
      organizationId="organization-id"
      postId="post-1"
      search={(input) => {
        onSearch(input);
        const query = input.query.toLowerCase();
        const fixtures = [member, voter, deferred].filter((contact) =>
          `${contact.name ?? ""} ${contact.email ?? ""}`
            .toLowerCase()
            .includes(query)
        );
        return Promise.resolve(fixtures);
      }}
      value={null}
    />
  );
}

async function typeQuery(
  screen: Awaited<ReturnType<typeof render>>,
  text: string
) {
  const input = screen.getByRole("combobox");
  await input.click();
  await input.fill(text);
}

describe("ContactCombobox", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("debounces the search until at least two characters are typed", async () => {
    const onSearch = vi.fn().mockResolvedValue([]);
    const screen = await render(
      <Harness onSearch={onSearch} onSelect={() => {}} />
    );

    await typeQuery(screen, "s");

    await expect
      .poll(() => onSearch.mock.calls.length, { timeout: 1_000 })
      .toBe(0);

    await typeQuery(screen, "sa");
    await expect
      .poll(() => onSearch.mock.calls.length, { timeout: 2_000 })
      .toBe(1);
    expect(onSearch.mock.calls[0]?.[0]).toMatchObject({
      organizationId: "organization-id",
      postId: "post-1",
      query: "sa",
    });
  });

  it("renders contact rows with badges and selects one", async () => {
    const onSearch = vi.fn().mockResolvedValue([member]);
    const onSelect = vi.fn();
    const screen = await render(<Harness onSearch={onSearch} onSelect={onSelect} />);

    await typeQuery(screen, "sarah");
    const row = screen.getByText("Sarah Chen");
    await expect.element(row).toBeVisible();
    await expect
      .element(screen.getByText("Workspace member"))
      .toBeVisible();

    await row.click();
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: member.contactId,
        email: member.email,
        name: member.name,
        userId: member.userId,
      })
    );
  });

  it("disables rows that already voted and shows the no-access hint", async () => {
    const onSearch = vi.fn().mockResolvedValue([voter, deferred]);
    const onSelect = vi.fn();
    const screen = await render(<Harness onSearch={onSearch} onSelect={onSelect} />);

    // Both fixture emails contain "acme." — long enough for the minimum
    // query length and specific enough to match both rows.
    await typeQuery(screen, "acme.");
    await expect.element(screen.getByText("Already voted")).toBeVisible();
    await expect
      .element(screen.getByText(/Won't be notified until they have access/))
      .toBeVisible();

    await screen.getByText("Al Ready").click();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("offers to create a new customer when nothing matches", async () => {
    const onSearch = vi.fn().mockResolvedValue([]);
    const onSelect = vi.fn();
    const screen = await render(<Harness onSearch={onSearch} onSelect={onSelect} />);

    await typeQuery(screen, "nobody@example.com");
    const createRow = screen.getByText(/as new customer/);
    await expect.element(createRow).toBeVisible();

    await createRow.click();
    expect(onSelect).toHaveBeenCalledWith({ email: "nobody@example.com" });
  });

  it("selects a visible result and clears the selection", async () => {
    const onSearch = vi.fn().mockResolvedValue([member]);
    let selection: ContactComboboxSelection | null = null;
    const onSelect = vi.fn((next: ContactComboboxSelection | null) => {
      selection = next;
    });
    const screen = await render(
      <Harness onSearch={onSearch} onSelect={onSelect} />
    );

    const input = screen.getByRole("combobox");
    await input.click();
    await input.fill("sarah");
    await expect.element(screen.getByText("Sarah Chen")).toBeVisible();

    await screen.getByText("Sarah Chen").click();

    expect(onSelect).toHaveBeenCalledTimes(1);
    // SAFETY: Test fixture — the handler assigns synchronously before this read.
    expect((selection as ContactComboboxSelection | null)?.contactId).toBe(
      member.contactId
    );
  });
});
