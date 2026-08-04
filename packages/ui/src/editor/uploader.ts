import {
  type EditorMediaUploadOptions,
  editorMediaUploadEndpoint,
  uploadedEditorMediaSchema,
} from "@feeblo/web-shared/auth-client";
import type { Uploader } from "prosekit/extensions/file";

type PendingEditorUpload = {
  readonly file: File;
  readonly organizationId?: string;
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
  options: EditorMediaUploadOptions & { deferUploads?: boolean } = {}
): Uploader<string> => {
  if (options.deferUploads) {
    return ({ file }) => {
      const previewUrl = URL.createObjectURL(file);
      pendingEditorUploads.set(previewUrl, {
        file,
        ...(options.organizationId
          ? { organizationId: options.organizationId }
          : {}),
      });
      return Promise.resolve(previewUrl);
    };
  }

  return ({ file, onProgress }) =>
    uploadEditorMediaFile({ file, onProgress, options }).then(({ url }) => url);
};

export type FinalizedEditorContent = {
  readonly assetIds: string[];
  readonly content: string;
};

export const finalizeEditorContent = async (
  content: string,
  organizationId?: string
): Promise<FinalizedEditorContent> => {
  let finalizedContent = content;
  const assetIds: string[] = [];

  for (const [previewUrl, pending] of pendingEditorUploads) {
    if (pending.organizationId !== organizationId) {
      continue;
    }

    if (!finalizedContent.includes(previewUrl)) {
      URL.revokeObjectURL(previewUrl);
      pendingEditorUploads.delete(previewUrl);
      continue;
    }

    const uploaded = await uploadEditorMediaFile({
      file: pending.file,
      options: organizationId ? { organizationId } : {},
    });
    finalizedContent = finalizedContent.split(previewUrl).join(uploaded.url);
    assetIds.push(uploaded.assetId);
    URL.revokeObjectURL(previewUrl);
    pendingEditorUploads.delete(previewUrl);
  }

  return { assetIds, content: finalizedContent };
};

export const editorUploader = createEditorUploader();
