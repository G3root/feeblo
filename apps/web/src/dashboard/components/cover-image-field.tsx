import { Button } from "@feeblo/ui/button";
import { Card } from "@feeblo/ui/card";
import { Spinner } from "@feeblo/ui/spinner";
import { toastManager } from "@feeblo/ui/toast";
import {
  editorMediaUploadEndpoint,
  uploadedEditorMediaSchema,
} from "@feeblo/web-shared/auth-client";
import {
  ImageRemove01Icon,
  ImageUpload01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type RefObject, useRef, useState } from "react";

/**
 * The cover image control shared by the changelog and help center editors.
 *
 * Uploading is immediate rather than deferred: a cover is one file that the
 * page renders outside the body, so there is no reason to wait for the save to
 * learn its URL. The asset id is handed back through `assetRef` because the
 * save must name it in `assetIds` for the server to promote the object out of
 * the temporary prefix.
 */
export function CoverImageField({
  assetRef,
  disabled = false,
  onChange,
  organizationId,
  value,
}: {
  assetRef: RefObject<string | null>;
  disabled?: boolean;
  onChange: (value: string | null) => void;
  organizationId: string;
  value: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const uploadCoverImage = async (file: File) => {
    setIsUploading(true);

    try {
      const { assetId, url } = await uploadCoverImageFile(file, organizationId);

      assetRef.current = assetId;
      onChange(url);
      toastManager.add({
        title: "Cover image added",
        type: "success",
      });
    } catch {
      toastManager.add({
        title: "Failed to upload cover image",
        type: "error",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const removeCoverImage = () => {
    assetRef.current = null;
    onChange(null);
  };

  return (
    <>
      {value ? (
        <Card className="overflow-hidden" size="sm">
          <div className="relative">
            <img
              alt=""
              className="aspect-[16/7] w-full object-cover"
              height={525}
              src={value}
              width={1200}
            />
            {disabled ? null : (
              <div className="absolute inset-x-0 bottom-0 flex justify-end gap-2 bg-gradient-to-t from-black/50 to-transparent p-3">
                <Button
                  aria-label="Replace cover image"
                  disabled={isUploading}
                  onClick={() => inputRef.current?.click()}
                  size="sm"
                  type="button"
                  variant="destructive"
                >
                  {isUploading ? (
                    <Spinner className="size-4" />
                  ) : (
                    <HugeiconsIcon icon={ImageUpload01Icon} />
                  )}
                  Replace
                </Button>
                <Button
                  aria-label="Remove cover image"
                  disabled={isUploading}
                  onClick={removeCoverImage}
                  size="sm"
                  type="button"
                  variant="destructive"
                >
                  <HugeiconsIcon icon={ImageRemove01Icon} />
                  Remove
                </Button>
              </div>
            )}
          </div>
        </Card>
      ) : (
        <Card className="h-32 items-center justify-center" size="sm">
          <Button
            aria-label="Add cover image"
            disabled={disabled || isUploading}
            onClick={() => inputRef.current?.click()}
            type="button"
            variant="secondary"
          >
            {isUploading ? (
              <Spinner className="size-4" />
            ) : (
              <HugeiconsIcon icon={ImageUpload01Icon} />
            )}
            Add cover image
          </Button>
        </Card>
      )}
      <input
        accept="image/gif,image/jpeg,image/png,image/webp"
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];

          if (file) {
            uploadCoverImage(file).catch(() => undefined);
          }

          event.target.value = "";
        }}
        ref={inputRef}
        type="file"
      />
    </>
  );
}

async function uploadCoverImageFile(
  file: File,
  organizationId: string
): Promise<{ assetId: string; url: string }> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("organizationId", organizationId);

  const response = await fetch(editorMediaUploadEndpoint, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Cover image upload failed with status ${response.status}`);
  }

  return uploadedEditorMediaSchema.parse(await response.json());
}
