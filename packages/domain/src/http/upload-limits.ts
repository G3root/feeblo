import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Multipart from "effect/unstable/http/Multipart";
import * as HttpApiMiddleware from "effect/unstable/httpapi/HttpApiMiddleware";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_FIELD_BYTES = 1 * 1024 * 1024;

/**
 * Enforces multipart parsing limits (file/total size, part count) while the
 * request is being streamed to disk, before the handler ever reads it. Without
 * this, an authenticated user can POST a multi-GB "image" that is fully
 * spooled and then read into memory before the handler's size check runs.
 */
export class UploadLimitsMiddleware extends HttpApiMiddleware.Service<UploadLimitsMiddleware>()(
  "@feeblo/api/UploadLimitsMiddleware",
  {}
) {}

export const UploadLimitsMiddlewareLive = Layer.succeed(
  UploadLimitsMiddleware,
  UploadLimitsMiddleware.of((effect) =>
    Effect.provide(
      effect,
      Multipart.limitsServices({
        maxFileSize: MAX_UPLOAD_BYTES,
        maxParts: 20,
        maxFieldSize: MAX_FIELD_BYTES,
        maxTotalSize: MAX_UPLOAD_BYTES + MAX_FIELD_BYTES,
      })
    )
  )
);
