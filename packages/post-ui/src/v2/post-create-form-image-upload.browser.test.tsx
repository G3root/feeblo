import { isFunction } from "@feeblo/utils/runtime-kind";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

// The widget form reads these workspace modules directly; the stub provides
// a faithful in-memory implementation for the upload schema endpoint boundary.
// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("@feeblo/web-shared/auth-client", () => ({
  editorMediaUploadEndpoint: "/api/media/upload",
  uploadedEditorMediaSchema: {
    parse: <T,>(value: T) => value,
  },
}));
// The widget form reads these workspace modules directly; the stub provides
// a faithful in-memory implementation for the RPC transport boundary.
// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("@feeblo/web-shared/runtime", () => ({
  fetchRpc: vi.fn().mockResolvedValue(undefined),
}));
// The widget form reads these workspace modules directly; the stub provides
// a faithful in-memory implementation for the auth state hook boundary.
// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("@feeblo/web-shared/use-auth-state", () => ({
  useAuthState: () => ({
    data: {
      session: { user: { id: "user-1", name: "nafees", image: null } },
      user: { id: "user-1", name: "nafees", image: null },
      memberships: [],
    },
  }),
}));

import { PostId } from "@feeblo/id";
import { useEffect, useState } from "react";

/** Member row the live-query stub exposes as the current member. */
type MockMember = {
  id: string;
  organizationId: string;
  userId: string;
};

let memberData: MockMember | undefined = {
  id: "member-1",
  organizationId: "organization-id",
  userId: "user-1",
};
let bumpRender: (() => void) | null = null;
function setMemberData(value: MockMember | undefined) {
  memberData = value;
  bumpRender?.();
}
// The form's TanStack DB queries are exercised through an in-memory seam that
// resolves the member / board / status reads the component performs.
type MockLiveResult = {
  data: MockMember | typeof board | typeof postStatus | undefined;
};

// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("@tanstack/react-db", () => ({
  and: (...args: unknown[]) => args,
  // Faithful seam for the form's optimistic create action: run the
  // optimistic insert, then the persistence function, surfacing failures
  // through `isPersisted` exactly like a real transaction.
  createOptimisticAction: vi.fn(
    (options: {
      onMutate: (variables: PostCreateActionInput) => void;
      mutationFn: (variables: PostCreateActionInput) => Promise<void>;
    }) =>
      (variables: PostCreateActionInput) => {
        const promise = (async () => {
          options.onMutate(variables);
          await options.mutationFn(variables);
        })();
        return { isPersisted: { promise } };
      },
  ),
  eq: () => ({ __eq: true }),
  queryOnce: vi.fn(),
  useLiveQuery: vi.fn((query: (q: never) => MockLiveResult) => {
    let alias = "";
    const fakeQ = {
      from: (
        arg: Record<string, string | number | boolean | null | undefined>
      ) => {
        alias = Object.keys(arg)[0] ?? "";
        const chain = { where: () => chain, findOne: () => undefined };
        return chain;
      },
    };
    // SAFETY: Test fixture: `never` marks an intentionally unsupported input to assert rejection.
    query(fakeQ as never);
    if (alias === "member") {
      return { data: memberData };
    }
    if (alias === "board") {
      return { data: [board] };
    }
    if (alias === "postStatus") {
      return { data: [postStatus] };
    }
    return { data: undefined };
  }),
}));
// The widget form reads these workspace modules directly; the stub provides
// a faithful in-memory implementation for the id generation boundary.
// The post form needs a deterministic generated post id for its upload flow.
// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("@feeblo/id", () => ({
  PostId: { unsafeGenerate: vi.fn().mockResolvedValue("post-1") },
}));

import type { PostCreateActionInput } from "./dialogs/post-create-form-inner";
import type { PersistPostInput } from "./providers/post-collections-provider";

import { PostCreateDialogProvider } from "./dialog-stores/post";
import { PostCreateForm } from "./dialogs/post-create-form-inner";
import { PostCollectionsProvider } from "./providers/post-collections-provider";

class MockXMLHttpRequest {
  static sendCount = 0;

  readonly upload = new EventTarget();
  readonly open = vi.fn();
  readonly addEventListener = vi.fn(
    (type: string, listener: EventListenerOrEventListenerObject) => {
      this.listeners.set(type, listener);
    }
  );
  readonly send = vi.fn(() => {
    MockXMLHttpRequest.sendCount += 1;
    this.status = 200;
    this.responseText = JSON.stringify({
      assetId: "asset-uploaded-on-save",
      bucket: "test-bucket",
      key: "tmp/editor-media/user/image/upload.png",
      kind: "image",
      url: "https://assets.example/tmp/editor-media/upload.png",
    });
    queueMicrotask(() => this.dispatch("load"));
  });
  responseText = "";
  status = 0;
  timeout = 0;
  withCredentials = false;

  private readonly listeners = new Map<
    string,
    EventListenerOrEventListenerObject
  >();

  private dispatch(type: string) {
    const listener = this.listeners.get(type);
    if (isFunction(listener)) {
      // SAFETY: the non-object union branch is a callable EventListener.
      (listener as (event: Event) => void)(new Event(type));
    } else if (listener && "handleEvent" in listener) {
      listener.handleEvent(new Event(type));
    }
  }
}

const board = {
  archivedAt: null,
  createdAt: new Date(),
  id: "board-1",
  name: "Board",
  organizationId: "organization-id",
  slug: "board",
  updatedAt: new Date(),
  visibility: "PUBLIC",
};
const postStatus = {
  archivedAt: null,
  boardIds: null,
  createdAt: new Date(),
  id: "status-1",
  name: "Planned",
  organizationId: "organization-id",
  type: "PLANNED",
  updatedAt: new Date(),
};

const insertSpy = vi.fn().mockReturnValue({
  isPersisted: { promise: Promise.resolve() },
});

// Captures the surface persistence input the form's optimistic action
// passes (row fields plus finalized body); the RPC transport itself stays
// mocked (see the `@feeblo/web-shared/runtime` mock above).
const persistSpy = vi
  .fn<(input: PersistPostInput) => Promise<void>>()
  .mockResolvedValue(undefined);

function FormHarness() {
  const [, forceRender] = useState(0);
  useEffect(() => {
    bumpRender = () => forceRender((count) => count + 1);
    return () => {
      bumpRender = null;
    };
  }, []);

  return (
    <PostCreateDialogProvider>
      <PostCollectionsProvider
        collections={
          // SAFETY: Test fixture: `never` marks an intentionally unsupported input to assert rejection.
          {
            boardCollection: {},
            membersCollection: {},
            postCollection: {
              insert: insertSpy,
              utils: { refetch: vi.fn().mockResolvedValue(undefined) },
            },
            postStatusCollection: {},
            commentCollection: {},
            postReactionCollection: {},
            commentReactionCollection: {},
            upvoteCollection: {},
          } as never
        }
        organizationId="organization-id"
        persistPost={persistSpy}
      >
        <PostCreateForm />
      </PostCollectionsProvider>
    </PostCreateDialogProvider>
  );
}

type RenderScreen = Awaited<ReturnType<typeof render>>;

async function fillForm(screen: RenderScreen) {
  const title = screen.getByRole("textbox", { name: "Post Title" });
  await title.fill("My great idea");

  const boardCombo = screen.getByRole("combobox").all()[0];
  await boardCombo.click();
  await screen.getByRole("option", { name: "Board" }).click();
}

async function pasteImage(screen: RenderScreen, text: string) {
  const editor = screen.getByRole("textbox", { name: "" }).all()[1];
  await editor.click();
  await editor.fill(text);

  const clipboardData = new DataTransfer();
  clipboardData.items.add(
    new File([new Uint8Array([137, 80, 78, 71])], "upload.png", {
      type: "image/png",
    })
  );
  editor
    .element()
    .dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, clipboardData })
    );
}

async function submit(screen: RenderScreen): Promise<string> {
  await screen.getByRole("button", { name: "Create Post" }).click();
  // SAFETY: The upstream contract guarantees a string here.
  await waitForInsertCount(1);
  // The body travels as optimistic-action input to `persistPost`, not on
  // the slim list row.
  // SAFETY: The harness's persistPost receives the form's persistence input.
  const persisted = persistSpy.mock.calls[0]?.[0] as { content: string };
  return persisted.content;
}

async function waitForInsertCount(expectedCount: number): Promise<void> {
  await vi.waitFor(() => {
    expect(insertSpy.mock.calls.length).toBeGreaterThanOrEqual(expectedCount);
  });
}

beforeEach(() => {
  MockXMLHttpRequest.sendCount = 0;
  insertSpy.mockClear();
  persistSpy.mockClear();
  vi.mocked(PostId.unsafeGenerate).mockClear();
  vi.stubGlobal("XMLHttpRequest", MockXMLHttpRequest);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PostCreateForm image upload", () => {
  it("saves the uploaded asset url instead of the blob url for an org member", async () => {
    setMemberData({
      id: "member-1",
      organizationId: "organization-id",
      userId: "user-1",
    });
    const screen = await render(<FormHarness />);

    await fillForm(screen);
    await pasteImage(screen, "A post with an image");
    await expect
      .element(screen.getByRole("img", { name: "upload preview" }))
      .toBeVisible();
    const content = await submit(screen);

    expect(insertSpy).toHaveBeenCalled();
    expect(content).not.toContain("blob:");
    expect(content).toContain(
      "https://assets.example/tmp/editor-media/upload.png"
    );
  });

  it("saves the uploaded asset url when the user is not a member (user owner)", async () => {
    setMemberData(undefined);
    const screen = await render(<FormHarness />);

    await fillForm(screen);
    await pasteImage(screen, "A post with an image");
    await expect
      .element(screen.getByRole("img", { name: "upload preview" }))
      .toBeVisible();
    const content = await submit(screen);

    expect(insertSpy).toHaveBeenCalled();
    expect(content).not.toContain("blob:");
    expect(content).toContain(
      "https://assets.example/tmp/editor-media/upload.png"
    );
  });

  it("uploads images deferred before the member query resolves", async () => {
    // The editor mounts with a user-owned uploader (membership is still
    // loading), then the member query resolves before submit.
    setMemberData(undefined);
    const screen = await render(<FormHarness />);

    await fillForm(screen);
    await pasteImage(screen, "A post with an image");
    await expect
      .element(screen.getByRole("img", { name: "upload preview" }))
      .toBeVisible();

    setMemberData({
      id: "member-1",
      organizationId: "organization-id",
      userId: "user-1",
    });
    const content = await submit(screen);

    expect(insertSpy).toHaveBeenCalled();
    expect(content).not.toContain("blob:");
    expect(content).toContain(
      "https://assets.example/tmp/editor-media/upload.png"
    );
  });

  it("reuploads for the organization when ownership changes after a failed save", async () => {
    setMemberData(undefined);
    // The first persistence attempt fails; the optimistic row rolls back
    // and the retry uploads under the resolved member.
    persistSpy.mockRejectedValueOnce(new Error("Save failed"));
    const screen = await render(<FormHarness />);

    await fillForm(screen);
    await pasteImage(screen, "A post with an image");
    const submitButton = screen.getByRole("button", { name: "Create Post" });
    await submitButton.click();
    await waitForInsertCount(1);
    await expect.element(submitButton).toBeEnabled();

    setMemberData({
      id: "member-1",
      organizationId: "organization-id",
      userId: "user-1",
    });
    await submitButton.click();
    await waitForInsertCount(2);

    expect(MockXMLHttpRequest.sendCount).toBe(2);
    // See `submit`: the body travels as action input, not on the slim row.
    // SAFETY: The retry persists through the same harness spy.
    const repersisted = persistSpy.mock.calls[1]?.[0] as { content: string };
    expect(repersisted.content).not.toContain("blob:");
  });
});
