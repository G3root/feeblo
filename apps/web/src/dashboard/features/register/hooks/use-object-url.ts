import { useEffect, useMemo } from "react";

/**
 * A temporary URL for a file the browser is holding.
 *
 * The logo is picked before the workspace exists, so there is nothing to upload
 * it to yet and nothing to link to. `createObjectURL` gives the preview and the
 * picker the same picture without a round trip, and the cleanup is what keeps a
 * reader who tries four logos from leaking four blobs.
 */
export function useObjectUrl(file: File | null): string | null {
  const url = useMemo(
    () => (file === null ? null : URL.createObjectURL(file)),
    [file]
  );

  useEffect(
    () => () => {
      if (url !== null) {
        URL.revokeObjectURL(url);
      }
    },
    [url]
  );

  return url;
}
