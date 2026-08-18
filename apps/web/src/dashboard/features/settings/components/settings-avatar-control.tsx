import { isNumber } from "@feeblo/utils/runtime-kind";
import { Button } from "@feeblo/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@feeblo/ui/dialog";
import { Label } from "@feeblo/ui/label";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@feeblo/ui/menu";
import { Slider } from "@feeblo/ui/slider";
import { toastManager } from "@feeblo/ui/toast";
import { UserAvatar } from "@feeblo/ui/user-avatar";
import { Cancel01Icon, Edit01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type * as React from "react";
import { createContext, use, useCallback, useRef, useState } from "react";
import AvatarEditor, { type AvatarEditorRef } from "react-avatar-editor";

interface SettingsAvatarControlContextValue {
  ariaLabel: string;
  imageAlt: string;
  imageUrl: string | null | undefined;
  maxSize?: number;
  name: string;
  onRemove?: (() => Promise<void>) | undefined;
  onUpload: (file: File) => Promise<void>;
  openFileDialog: () => void;
}

const SettingsAvatarControlContext =
  createContext<SettingsAvatarControlContextValue | null>(null);

const MAX_CROPPED_IMAGE_DIMENSION = 1024;
const MAX_CROPPED_IMAGE_SIZE = 5 * 1024 * 1024;
// Cap decoded source dimensions (~25MP) so getImage() can never allocate a
// natural-resolution canvas from an unbounded source (e.g. a huge PNG/WebP
// with a small byte size).
const MAX_SOURCE_IMAGE_PIXELS = 25_000_000;
const EDITOR_SIZE = 288;

function useSettingsAvatarControl() {
  const value = use(SettingsAvatarControlContext);

  if (!value) {
    throw new Error(
      "SettingsAvatarControl components must be used within SettingsAvatarControl.Root"
    );
  }

  return value;
}

async function hasExcessiveSourcePixels(file: File): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(file);
    const excessive = bitmap.width * bitmap.height > MAX_SOURCE_IMAGE_PIXELS;
    bitmap.close();
    return excessive;
  } catch {
    // Let AvatarEditor surface decode failures via onLoadFailure.
    return false;
  }
}

async function createCroppedImage(
  source: HTMLCanvasElement,
  fileName: string
): Promise<File> {
  const scale = Math.min(
    1,
    MAX_CROPPED_IMAGE_DIMENSION / Math.max(source.width, source.height)
  );
  const outputWidth = Math.max(1, Math.round(source.width * scale));
  const outputHeight = Math.max(1, Math.round(source.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get canvas context");
  }

  ctx.drawImage(source, 0, 0, outputWidth, outputHeight);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Canvas is empty"));
          return;
        }

        if (blob.size > MAX_CROPPED_IMAGE_SIZE) {
          reject(new Error("Cropped image exceeds the 5MB limit"));
          return;
        }

        const croppedFile = new File([blob], `cropped-${fileName}`, {
          type: "image/webp",
        });
        resolve(croppedFile);
      },
      "image/webp",
      0.9
    );
  });
}

function Root({
  accept = "image/jpeg,image/png,image/webp",
  ariaLabel,
  children,
  imageAlt,
  imageUrl,
  maxSize,
  name,
  onUpload,
  onRemove,
}: {
  accept?: string;
  ariaLabel: string;
  children: React.ReactNode;
  imageAlt: string;
  imageUrl: string | null | undefined;
  maxSize?: number;
  name: string;
  onUpload: (file: File) => Promise<void>;
  onRemove?: (() => Promise<void>) | undefined;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<AvatarEditorRef>(null);
  // Bumped on every new file selection and on crop dialog close; in-flight
  // validations compare against it to discard stale continuations.
  const selectionVersionRef = useRef(0);
  const isCroppingRef = useRef(false);
  const [isCropping, setIsCropping] = useState(false);
  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [zoom, setZoom] = useState(1);
  const [resetKey, setResetKey] = useState(0);
  const [isImageReady, setIsImageReady] = useState(false);

  const handleCropDialogOpenChange = useCallback((open: boolean) => {
    setCropDialogOpen(open);
    if (!open) {
      selectionVersionRef.current += 1;
      setZoom(1);
      setResetKey((key) => key + 1);
      setSelectedFile(null);
      setIsImageReady(false);
    }
  }, []);

  const onCropApply = useCallback(async () => {
    if (isCroppingRef.current) {
      return;
    }

    const editor = editorRef.current;
    if (!(selectedFile && editor)) {
      return;
    }

    isCroppingRef.current = true;
    setIsCropping(true);

    try {
      const croppedFile = await createCroppedImage(
        editor.getImage(),
        selectedFile.name
      );

      await onUpload(croppedFile);

      handleCropDialogOpenChange(false);
    } catch (error) {
      toastManager.add({
        title: error instanceof Error ? error.message : "Failed to crop image",
        type: "error",
      });
    } finally {
      isCroppingRef.current = false;
      setIsCropping(false);
    }
  }, [selectedFile, onUpload, handleCropDialogOpenChange]);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    // A new selection supersedes any in-flight validation.
    const version = ++selectionVersionRef.current;

    if (maxSize !== undefined && file.size > maxSize) {
      toastManager.add({
        title: `File size exceeds ${Math.round(maxSize / (1024 * 1024))}MB limit`,
        type: "error",
      });
      event.target.value = "";
      return;
    }

    if (await hasExcessiveSourcePixels(file)) {
      if (selectionVersionRef.current !== version) {
        event.target.value = "";
        return;
      }
      toastManager.add({
        title: "Image dimensions exceed the 25MP limit",
        type: "error",
      });
      event.target.value = "";
      return;
    }

    if (selectionVersionRef.current !== version) {
      event.target.value = "";
      return;
    }

    setSelectedFile(file);
    setZoom(1);
    setIsImageReady(false);
    setCropDialogOpen(true);
    event.target.value = "";
  }

  function openFileDialog() {
    fileInputRef.current?.click();
  }

  return (
    <SettingsAvatarControlContext
      value={{
        ariaLabel,
        imageAlt,
        imageUrl,
        maxSize,
        name,
        onRemove,
        onUpload,
        openFileDialog,
      }}
    >
      <input
        accept={accept}
        className="hidden"
        onChange={handleFileChange}
        ref={fileInputRef}
        type="file"
      />
      {children}
      <Dialog onOpenChange={handleCropDialogOpenChange} open={cropDialogOpen}>
        {cropDialogOpen ? (
          <DialogPopup bottomStickOnMobile showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Crop Image</DialogTitle>
              <DialogDescription>
                Adjust the crop area and zoom level for {selectedFile?.name}
              </DialogDescription>
            </DialogHeader>
            <div className="px-6 pb-4">
              {selectedFile ? (
                <div className="flex flex-col gap-4">
                  <AvatarEditor
                    border={0}
                    borderRadius={EDITOR_SIZE / 2}
                    color={[0, 0, 0, 0.5]}
                    gridColor="rgba(255, 255, 255, 0.5)"
                    height={EDITOR_SIZE}
                    image={selectedFile}
                    key={resetKey}
                    onImageReady={() => setIsImageReady(true)}
                    onLoadFailure={() => {
                      toastManager.add({
                        title: "Failed to load image",
                        type: "error",
                      });
                    }}
                    ref={editorRef}
                    scale={zoom}
                    showGrid
                    width={EDITOR_SIZE}
                  />
                  <div className="flex items-center gap-3">
                    <Label className="text-sm whitespace-nowrap">Zoom</Label>
                    <Slider
                      max={3}
                      min={1}
                      onValueChange={(value) => {
                        const first =
                          isNumber(value) ? value : value[0];
                        setZoom(first ?? 1);
                      }}
                      step={0.1}
                      value={[zoom]}
                    />
                    <span className="text-muted-foreground w-10 text-right text-xs tabular-nums">
                      {zoom.toFixed(1)}x
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                onClick={() => {
                  setZoom(1);
                  setResetKey((key) => key + 1);
                  setIsImageReady(false);
                }}
                variant="outline"
              >
                Reset
              </Button>
              <Button
                disabled={!isImageReady || isCropping}
                onClick={onCropApply}
              >
                Crop
              </Button>
            </DialogFooter>
          </DialogPopup>
        ) : null}
      </Dialog>
    </SettingsAvatarControlContext>
  );
}

function ButtonComponent(props: React.ComponentProps<"button">) {
  const { ariaLabel, imageAlt, imageUrl, name, openFileDialog } =
    useSettingsAvatarControl();

  return (
    <div>
      <button
        aria-label={ariaLabel}
        onClick={(event) => {
          props.onClick?.(event);

          if (!event.defaultPrevented) {
            openFileDialog();
          }
        }}
        type="button"
        {...props}
      >
        <UserAvatar image={imageUrl} imageAlt={imageAlt} name={name} />
      </button>
    </div>
  );
}

function Dropdown({ children }: { children: React.ReactNode }) {
  return <Menu>{children}</Menu>;
}

function DropdownTrigger() {
  return <MenuTrigger render={<ButtonComponent />} />;
}

function DropdownMenu({ children }: { children: React.ReactNode }) {
  return <MenuPopup className="w-40">{children}</MenuPopup>;
}

function ChangeItem({ children }: { children: React.ReactNode }) {
  const { openFileDialog } = useSettingsAvatarControl();

  return (
    <MenuItem onClick={openFileDialog}>
      <HugeiconsIcon icon={Edit01Icon} />
      <span>{children}</span>
    </MenuItem>
  );
}

function RemoveItem({
  children,
  errorTitle,
  successTitle,
}: {
  children: React.ReactNode;
  errorTitle: string;
  successTitle: string;
}) {
  const { onRemove } = useSettingsAvatarControl();

  if (!onRemove) {
    return null;
  }

  return (
    <MenuItem
      onClick={async () => {
        try {
          await onRemove();
          toastManager.add({
            title: successTitle,
            type: "success",
          });
        } catch {
          toastManager.add({
            title: errorTitle,
            type: "error",
          });
        }
      }}
    >
      <HugeiconsIcon icon={Cancel01Icon} />
      <span>{children}</span>
    </MenuItem>
  );
}

export const SettingsAvatarControl = {
  Root,
  Button: ButtonComponent,
  Dropdown,
  DropdownTrigger,
  Menu: DropdownMenu,
  ChangeItem,
  RemoveItem,
};
