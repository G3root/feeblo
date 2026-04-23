/// Credit https://github.com/resend/react-email/blob/canary/packages/editor/src/plugins/image/types.ts

export interface UploadImageResult {
  url: string;
}

export interface UseEditorImageOptions {
  uploadImage: (file: File) => Promise<UploadImageResult>;
}
