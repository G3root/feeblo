import { hasWindow, isPlainObject, isString } from "@feeblo/utils/runtime-kind";
import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";
import * as Predicate from "effect/Predicate";

/**
 * The base the data-transfer file endpoints hang off. In dev the injected
 * API_URL is the proxy base ("/api") and must become the page origin before
 * the full `/api/...` path is appended, the same rule `auth-client.ts`
 * applies; an absolute production API_URL passes through unchanged.
 */
export const resolveApiBase = (apiUrl: string): string =>
  apiUrl.startsWith("/") && hasWindow() ? window.location.origin : apiUrl;

/** The URL of the dashboard API's transfer endpoints, resolved once per call. */
export const dataTransferApiBase = (): string =>
  resolveApiBase(getRuntimePublicEnv().apiUrl);

/**
 * The message an error envelope carries, when it is one. The dashboard HTTP
 * API answers a non-2xx with the tagged error's fields, so `message` is the
 * server's explanation whenever the failure was one it anticipated.
 */
export const errorEnvelopeMessage = async (
  response: Response
): Promise<string | null> => {
  const payload: unknown = await response.json().catch(() => null);
  return isPlainObject(payload) &&
    Predicate.hasProperty(payload, "message") &&
    isString(payload.message)
    ? payload.message
    : null;
};

/**
 * The server's download name when the response exposes it. A cross-origin
 * response hides `Content-Disposition` unless the CORS policy lists it, so
 * the caller falls back to a name built from the job itself.
 */
export const fileNameFromContentDisposition = (
  header: string | null
): string | null => {
  if (header === null) {
    return null;
  }
  const encoded = /filename\*=UTF-8''([^;]+)/iu.exec(header)?.[1];
  if (encoded !== undefined) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return null;
    }
  }
  return /filename="([^"]+)"/iu.exec(header)?.[1] ?? null;
};

/** Writes one in-memory blob to a download, then releases the object URL. */
export const downloadBlob = (blob: Blob, fileName: string): void => {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = fileName;
  link.href = objectUrl;
  link.click();
  URL.revokeObjectURL(objectUrl);
};

/**
 * Downloads a response body, preferring the server's name. The caller passes
 * the name to use when the header is hidden.
 */
export const downloadResponse = async (
  response: Response,
  fallbackFileName: string
): Promise<void> => {
  const blob = await response.blob();
  downloadBlob(
    blob,
    fileNameFromContentDisposition(
      response.headers.get("Content-Disposition")
    ) ?? fallbackFileName
  );
};
