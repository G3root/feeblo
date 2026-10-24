/**
 * Reads a request body without buffering past a byte limit.
 *
 * `Request.text()` buffers the whole body first, so a relay that checks the
 * size afterwards has already paid for it. This reader stops at the limit and
 * cancels the stream, which also protects against a client that lies about
 * `Content-Length` or omits it entirely.
 *
 * Returns `undefined` when the body exceeds `limit`; `""` when there is no
 * body.
 */
export const readBoundedText = async (
  request: Request,
  limit: number
): Promise<string | undefined> => {
  const reader = request.body?.getReader();
  if (reader === undefined) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(value);
    }
  } catch {
    return undefined;
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
};
