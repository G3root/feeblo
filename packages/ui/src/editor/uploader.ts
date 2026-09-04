import {
  type EditorMediaUploadOptions,
  editorMediaUploadEndpoint,
  uploadedEditorMediaSchema,
} from "@feeblo/web-shared/auth-client";
import type { Uploader } from "prosekit/extensions/file";

type PendingEditorUpload = {
  readonly file: File;
  readonly organizationId?: string;
  readonly scope: string;
  readonly uploaded?: UploadedEditorMedia & {
    readonly organizationId?: string;
  };
};

type UploadedEditorMedia = {
  readonly assetId: string;
  readonly url: string;
};

const pendingEditorUploads = new Map<string, PendingEditorUpload>();

const uploadEditorMediaFile = ({
  file,
  onProgress,
  options,
}: {
  readonly file: File;
  readonly onProgress?: (progress: { loaded: number; total: number }) => void;
  readonly options: EditorMediaUploadOptions;
}): Promise<UploadedEditorMedia> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("file", file);
    if (options.organizationId) {
      formData.append("organizationId", options.organizationId);
    }

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress?.({
          loaded: event.loaded,
          total: event.total,
        });
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status === 200) {
        try {
          const json = JSON.parse(xhr.responseText);
          const { assetId, url } = uploadedEditorMediaSchema.parse(json);
          resolve({ assetId, url });
        } catch (error) {
          reject(new Error("Failed to parse response", { cause: error }));
        }
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Upload failed"));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("Upload aborted"));
    });

    xhr.addEventListener("timeout", () => {
      reject(new Error("Upload timed out"));
    });

    xhr.open("POST", editorMediaUploadEndpoint, true);
    xhr.timeout = options.timeoutMs ?? 120_000;
    xhr.withCredentials = true;
    xhr.send(formData);
  });

export const createEditorUploader = (
  options: EditorMediaUploadOptions & {
    deferUploads?: boolean;
    scope?: string;
  } = {}
): Uploader<string> => {
  if (options.deferUploads) {
    return ({ file }) => {
      const previewUrl = URL.createObjectURL(file);
      pendingEditorUploads.set(previewUrl, {
        file,
        scope: options.scope ?? previewUrl,
        ...(options.organizationId && {
          organizationId: options.organizationId,
        }),
      });
      return Promise.resolve(previewUrl);
    };
  }

  return ({ file, onProgress }) =>
    uploadEditorMediaFile({ file, onProgress, options }).then(({ url }) => url);
};

export type FinalizedEditorContent = {
  readonly assetIds: string[];
  readonly commit: () => void;
  readonly content: string;
};

export const finalizeEditorContent = async (
  content: string,
  organizationId?: string,
  options: {
    readonly assetIds?: readonly string[];
    readonly scope?: string;
  } = {}
): Promise<FinalizedEditorContent> => {
  let finalizedContent = content;
  const assetIds = [...(options.assetIds ?? [])];
  const finalizedUploads: Array<{
    pending: PendingEditorUpload;
    previewUrl: string;
  }> = [];

  // Eligibility filtering stays synchronous; only the network uploads below
  // run concurrently.
  const eligible: Array<{
    pending: PendingEditorUpload;
    previewUrl: string;
  }> = [];
  for (const [previewUrl, pending] of pendingEditorUploads) {
    // Asset ownership is decided at finalize time, not at insert time. The
    // editor may be mounted before the member/organization check resolves
    // (e.g. the create-post form mounts with a user-owned uploader, then the
    // member query resolves and finalize runs with the organization id).
    // A pending upload that was deferred without an organization can therefore
    // be finalized under the current owner; an explicitly org-owned upload must
    // still match the same organization.
    const organizationMismatch =
      pending.organizationId !== undefined &&
      pending.organizationId !== organizationId;
    if (
      organizationMismatch ||
      (options.scope !== undefined && pending.scope !== options.scope)
    ) {
      continue;
    }

    if (!finalizedContent.includes(previewUrl)) {
      URL.revokeObjectURL(previewUrl);
      pendingEditorUploads.delete(previewUrl);
      continue;
    }

    eligible.push({ pending, previewUrl });
  }

  // Uploads are independent XHRs: run them together so N pasted images
  // cost one upload latency instead of N. Replacement application stays
  // sequential below (string read-modify-write would race otherwise) in
  // the original paste order, preserving today's result exactly.
  // allSettled (not all) so one rejection still records its successful
  // siblings in pendingEditorUploads; the retry then reuses them instead of
  // re-uploading (which would orphan the first asset).
  const settledEntries = await Promise.allSettled(
    eligible.map(async ({ pending, previewUrl }) => ({
      pending,
      previewUrl,
      uploaded:
        pending.uploaded !== undefined &&
        pending.uploaded.organizationId === organizationId
          ? pending.uploaded
          : {
              ...(await uploadEditorMediaFile({
                file: pending.file,
                options: organizationId ? { organizationId } : {},
              })),
              ...(organizationId && { organizationId }),
            },
    }))
  );

  let firstError: unknown;
  for (const settled of settledEntries) {
    if (settled.status === "rejected") {
      firstError ??= settled.reason;
      continue;
    }
    const { pending, previewUrl, uploaded } = settled.value;
    const uploadedPending = { ...pending, uploaded };
    pendingEditorUploads.set(previewUrl, uploadedPending);
    finalizedContent = finalizedContent.split(previewUrl).join(uploaded.url);
    if (!assetIds.includes(uploaded.assetId)) {
      assetIds.push(uploaded.assetId);
    }
    finalizedUploads.push({ pending: uploadedPending, previewUrl });
  }

  if (firstError !== undefined) {
    throw firstError;
  }

  return {
    assetIds,
    commit: () => {
      for (const { pending, previewUrl } of finalizedUploads) {
        if (pendingEditorUploads.get(previewUrl) !== pending) {
          continue;
        }
        URL.revokeObjectURL(previewUrl);
        pendingEditorUploads.delete(previewUrl);
      }
    },
    content: finalizedContent,
  };
};
