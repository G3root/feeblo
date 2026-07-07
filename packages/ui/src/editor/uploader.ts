import {
  editorMediaUploadEndpoint,
  uploadedEditorMediaSchema,
} from "@feeblo/web-shared/auth-client";
import type { Uploader } from "prosekit/extensions/file";

export const editorUploader: Uploader<string> = ({
  file,
  onProgress,
}): Promise<string> => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("file", file);

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

    xhr.open("POST", editorMediaUploadEndpoint, true);
    xhr.withCredentials = true;
    xhr.send(formData);
  });
};
