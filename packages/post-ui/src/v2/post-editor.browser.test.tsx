import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

vi.mock("@feeblo/web-shared/auth-client", () => ({
  editorMediaUploadEndpoint: "/api/media/upload",
  uploadedEditorMediaSchema: {
    parse: (value: unknown) => value,
  },
}));
vi.mock("@feeblo/web-shared/runtime", () => ({
  fetchRpc: vi.fn(),
}));

import { PostEditor } from "./post-editor";

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
    if (typeof listener === "function") {
      listener(new Event(type));
    } else {
      listener?.handleEvent(new Event(type));
    }
  }
}

beforeEach(() => {
  MockXMLHttpRequest.sendCount = 0;
  vi.stubGlobal("XMLHttpRequest", MockXMLHttpRequest);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PostEditor", () => {
  it("uploads an image and submits the editor content", async () => {
    const onSubmit = vi.fn();
    const screen = await render(
      <PostEditor
        onSubmit={onSubmit}
        organizationId="organization-id"
        submitLabel="Save"
      >
        <PostEditor.Submit />
      </PostEditor>
    );

    const editor = screen.getByRole("textbox");
    await editor.click();
    await editor.fill("A post with an image");

    const clipboardData = new DataTransfer();
    clipboardData.items.add(
      new File([new Uint8Array([137, 80, 78, 71])], "upload.png", {
        type: "image/png",
      })
    );
    editor.element().dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        clipboardData,
      })
    );

    await expect.element(screen.getByRole("img")).toBeVisible();
    expect(MockXMLHttpRequest.sendCount).toBe(0);

    await screen.getByRole("button", { name: "Save" }).click();

    await vi.waitFor(() => {
      expect(MockXMLHttpRequest.sendCount).toBe(1);
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit.mock.calls[0]?.[0].content).toContain(
        "https://assets.example/tmp/editor-media/upload.png"
      );
      expect(onSubmit.mock.calls[0]?.[0].assetIds).toEqual([
        "asset-uploaded-on-save",
      ]);
    });
  });

  it("reuses an uploaded image when saving the post fails", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error("Save failed"))
      .mockResolvedValueOnce(undefined);
    const screen = await render(
      <PostEditor
        onSubmit={onSubmit}
        organizationId="organization-id"
        submitLabel="Save"
      >
        <PostEditor.Submit />
      </PostEditor>
    );

    const editor = screen.getByRole("textbox");
    await editor.click();
    const clipboardData = new DataTransfer();
    clipboardData.items.add(
      new File([new Uint8Array([137, 80, 78, 71])], "retry.png", {
        type: "image/png",
      })
    );
    editor
      .element()
      .dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, clipboardData })
      );

    await expect.element(screen.getByRole("img")).toBeVisible();
    await screen.getByRole("button", { name: "Save" }).click();
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    await screen.getByRole("button", { name: "Save" }).click();
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));

    expect(MockXMLHttpRequest.sendCount).toBe(1);
    expect(onSubmit.mock.calls[1]?.[0]).toEqual({
      assetIds: ["asset-uploaded-on-save"],
      content: expect.stringContaining(
        "https://assets.example/tmp/editor-media/upload.png"
      ),
    });
  });
});
