import {
  type EditorMediaUploadOptions,
  editorMediaUploadEndpoint,
  uploadedEditorMediaSchema,
} from "@feeblo/web-shared/auth-client";
import type { Uploader } from "prosekit/extensions/file";

export const createEditorUploader =
  (options: EditorMediaUploadOptions = {}): Uploader<string> =>
  ({ file, onProgress }): Promise<string> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append("file", file);
      if (options.organizationId) {
        formData.append("organizationId", options.organizationId);
      }

      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          onProgress({
            loaded: event.loaded,
            total: event.total,
          });
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status === 200) {
          try {
            const json = JSON.parse(xhr.responseText);
            const { url } = uploadedEditorMediaSchema.parse(json);
            resolve(url);
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
      xhr.withCredentials = true;
      xhr.send(formData);
    });

export const editorUploader = createEditorUploader();
