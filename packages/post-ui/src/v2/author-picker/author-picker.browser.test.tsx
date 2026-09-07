import type { TContactSearchResult } from "@feeblo/domain/contact/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import type { ContactComboboxSelection } from "../contact-combobox/contact-combobox";
import { AuthorPicker } from "./author-picker";

// The picker imports the runtime transport transitively; the tests inject
// their own `search` implementation, so the real module (which reads Node
// globals) is stubbed out of the browser bundle.
// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("@feeblo/web-shared/runtime", () => ({
  fetchRpc: () => Promise.resolve([]),
}));

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

type SelectionHandler = (
  selection: ContactComboboxSelection | null
) => void | Promise<void>;

function Harness({ onSelect }: { onSelect: SelectionHandler }) {
  return (
    <AuthorPicker
      display={{ name: "John Doe", avatarUrl: null }}
      label="Change author"
      onSelect={onSelect}
      organizationId="organization-id"
      postId="post-1"
      search={({ query }) =>
        Promise.resolve(
          [customer].filter((contact) =>
            `${contact.name ?? ""} ${contact.email ?? ""}`
              .toLowerCase()
              .includes(query.toLowerCase())
          )
        )
      }
      value={null}
    />
  );
}

/**
 * The popover popup mounts asynchronously (positioning); poll for it.
 * `query()` resolves synchronously to the element or null, so it is safe
 * to poll for both appearance and disappearance.
 */
async function expectComboboxOpen(
  screen: Awaited<ReturnType<typeof render>>,
  open: boolean
) {
  await expect
    .poll(() => screen.getByRole("combobox").query() !== null, {
      timeout: 5_000,
    })
    .toBe(open);
}

describe("AuthorPicker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the search popover from the trigger and picks a person", async () => {
    const onSelect = vi.fn();
    const screen = await render(<Harness onSelect={onSelect} />);

    await screen.getByRole("button", { name: /Change author/ }).click();
    await expectComboboxOpen(screen, true);

    const input = screen.getByRole("combobox");
    await input.click();
    await input.fill("john");
    // The trigger and the row share the name; the row is the second match.
    const row = screen.getByText("John Doe").nth(1);
    await expect.element(row).toBeVisible();

    await row.click();
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: customer.contactId,
        email: customer.email,
        name: customer.name,
      })
    );
    // The popover closes once the selection settles.
    await expectComboboxOpen(screen, false);
  });

  it("creates a brand new user through the footer dialog", async () => {
    const onSelect = vi.fn();
    const screen = await render(<Harness onSelect={onSelect} />);

    await screen.getByRole("button", { name: /Change author/ }).click();
    await screen.getByRole("button", { name: /Add a brand new user/ }).click();

    // The unstyled test bundle stacks the modal under the popover, so the
    // submit button is not pointer-reachable here; dispatch the click
    // directly instead of hit-testing it. (With app CSS the modal centers
    // above the popover, as in the voter flow.)
    await screen.getByLabelText("Name").fill("New Person");
    await screen.getByLabelText("Email").fill("new@example.com");
    const submit = screen
      .getByRole("button", { name: /Create & set author/ })
      .element();
    if (!(submit instanceof HTMLElement)) {
      throw new Error("Submit button is not an HTML element");
    }
    submit.click();

    expect(onSelect).toHaveBeenCalledWith({
      email: "new@example.com",
      name: "New Person",
    });
  });

  it("picks a contact who already voted (voting never blocks authorship)", async () => {
    const votedCustomer: TContactSearchResult = {
      ...customer,
      alreadyVoted: true,
    };
    const onSelect = vi.fn();
    const screen = await render(
      <AuthorPicker
        display={{ name: "John Doe", avatarUrl: null }}
        label="Change author"
        onSelect={onSelect}
        organizationId="organization-id"
        postId="post-1"
        search={() => Promise.resolve([votedCustomer])}
        value={null}
      />
    );

    await screen.getByRole("button", { name: /Change author/ }).click();
    await expectComboboxOpen(screen, true);

    const input = screen.getByRole("combobox");
    await input.click();
    await input.fill("john");
    const row = screen.getByText("John Doe").nth(1);
    await expect.element(row).toBeVisible();
    // No Already-voted badge in author context, and the row is enabled.
    await expect
      .poll(() => screen.getByText("Already voted").query() !== null, {
        timeout: 1_000,
      })
      .toBe(false);

    await row.click();
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: customer.contactId })
    );
  });

  it("renders static text when disabled", async () => {
    const onSelect = vi.fn();
    const screen = await render(
      <AuthorPicker
        disabled
        display={{ name: "John Doe", avatarUrl: null }}
        label="Change author"
        onSelect={onSelect}
        organizationId="organization-id"
        value={null}
      />
    );

    await expect.element(screen.getByText("John Doe")).toBeVisible();
    await expect
      .poll(
        () => screen.getByRole("button", { name: /Change author/ }).query(),
        { timeout: 1_000 }
      )
      .toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
