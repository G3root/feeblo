import type { ImageUploadResult } from "~/components/ui/rich-text-editor";
import {
  editorMediaUploadEndpoint,
  uploadedEditorMediaSchema,
} from "~/lib/auth-client";

const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function isRichTextContentEmpty(content: string) {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return true;
  }

  if (!/<\/?[a-z][\s\S]*>/i.test(trimmed)) {
    return trimmed.length === 0;
  }

  if (/<img\b/i.test(trimmed)) {
    return false;
  }

  const textOnly = trimmed
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return textOnly.length === 0;
}

function escapeHtml(content: string) {
  return content
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function toRenderableRichTextHtml(content: string) {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return "";
  }

  if (/<\/?[a-z][\s\S]*>/i.test(trimmed)) {
    return content;
  }

  return content
    .split(/\n+/)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}

export async function uploadPostEditorImage(
  file: File
): Promise<ImageUploadResult | null> {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Unsupported file type. Use PNG, JPEG, WEBP, or GIF");
  }

  if (file.size === 0 || file.size > MAX_IMAGE_UPLOAD_BYTES) {
    throw new Error("Image must be between 1B and 10MB");
  }

  const formData = new FormData();
  formData.set("file", file);

  const response = await fetch(editorMediaUploadEndpoint, {
    body: formData,
    credentials: "include",
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Failed to upload image");
  }

  const payload = uploadedEditorMediaSchema.parse(await response.json());
  if (payload.kind !== "image") {
    throw new Error("Upload did not return an image");
  }

  return {
    alt: file.name,
    src: payload.url,
  };
}
