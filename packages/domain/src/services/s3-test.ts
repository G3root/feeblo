import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { S3UploadService } from "./s3";

const service = {
  uploadProfileImage: () => Effect.die("not used in this test"),
  uploadOrganizationLogo: () => Effect.die("not used in this test"),
  uploadEditorMedia: () => Effect.die("not used in this test"),
  promoteEditorMedia: () => Effect.die("not used in this test"),
  deleteObject: () => Effect.die("not used in this test"),
};

export const S3Test = Layer.succeed(S3UploadService, service);
