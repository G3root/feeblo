/** biome-ignore-all lint/suspicious/useAwait: <explanation> */
import { Button } from "@feeblo/ui/button";
import {
  Cropper,
  CropperArea,
  type CropperAreaData,
  CropperImage,
  type CropperPoint,
} from "@feeblo/ui/cropper";
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
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

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

function useSettingsAvatarControl() {
  const value = use(SettingsAvatarControlContext);

  if (!value) {
    throw new Error(
      "SettingsAvatarControl components must be used within SettingsAvatarControl.Root"
    );
  }

  return value;
}

async function createCroppedImage(
  imageSrc: string,
  cropData: CropperAreaData,
  fileName: string
): Promise<File> {
  const image = new Image();
  image.crossOrigin = "anonymous";

  return new Promise((resolve, reject) => {
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        reject(new Error("Could not get canvas context"));
        return;
      }

      const scale = Math.min(
        1,
        MAX_CROPPED_IMAGE_DIMENSION / Math.max(cropData.width, cropData.height)
      );
      const outputWidth = Math.max(1, Math.round(cropData.width * scale));
      const outputHeight = Math.max(1, Math.round(cropData.height * scale));

      canvas.width = outputWidth;
      canvas.height = outputHeight;

      ctx.drawImage(
        image,
        cropData.x,
        cropData.y,
        cropData.width,
        cropData.height,
        0,
        0,
        outputWidth,
        outputHeight
      );

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
    };

    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = imageSrc;
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
  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState<CropperPoint>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<CropperAreaData | null>(null);

  useEffect(() => {
    return () => {
      if (selectedImageUrl) {
        URL.revokeObjectURL(selectedImageUrl);
      }
    };
  }, [selectedImageUrl]);

  const handleCropDialogOpenChange = useCallback((open: boolean) => {
    setCropDialogOpen(open);
    if (!open) {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedArea(null);
      setSelectedFile(null);
      setSelectedImageUrl(null);
    }
  }, []);

  const onCropApply = useCallback(async () => {
    if (!(selectedFile && croppedArea && selectedImageUrl)) {
      return;
    }

    try {
      const croppedFile = await createCroppedImage(
        selectedImageUrl,
        croppedArea,
        selectedFile.name
      );

      await onUpload(croppedFile);

      handleCropDialogOpenChange(false);
    } catch (error) {
      toastManager.add({
        title: error instanceof Error ? error.message : "Failed to crop image",
        type: "error",
      });
    }
  }, [
    selectedFile,
    croppedArea,
    selectedImageUrl,
    onUpload,
    handleCropDialogOpenChange,
  ]);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (maxSize !== undefined && file.size > maxSize) {
      toastManager.add({
        title: `File size exceeds ${Math.round(maxSize / (1024 * 1024))}MB limit`,
        type: "error",
      });
      event.target.value = "";
      return;
    }

    const url = URL.createObjectURL(file);
    setSelectedFile(file);
    setSelectedImageUrl(url);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedArea(null);
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
              {selectedFile && selectedImageUrl ? (
                <div className="flex flex-col gap-4">
                  <Cropper
                    aspectRatio={1}
                    className="h-80"
                    crop={crop}
                    onCropAreaChange={(_, croppedAreaPixels) =>
                      setCroppedArea(croppedAreaPixels)
                    }
                    onCropChange={setCrop}
                    onCropComplete={(_, croppedAreaPixels) =>
                      setCroppedArea(croppedAreaPixels)
                    }
                    onZoomChange={setZoom}
                    shape="circle"
                    withGrid
                    zoom={zoom}
                  >
                    <CropperImage
                      alt={selectedFile.name}
                      crossOrigin="anonymous"
                      src={selectedImageUrl}
                    />
                    <CropperArea />
                  </Cropper>
                  <div className="flex items-center gap-3">
                    <Label className="whitespace-nowrap text-sm">Zoom</Label>
                    <Slider
                      max={3}
                      min={1}
                      onValueChange={(value) => {
                        const first =
                          typeof value === "number" ? value : value[0];
                        setZoom(first ?? 1);
                      }}
                      step={0.1}
                      value={[zoom]}
                    />
                    <span className="w-10 text-right text-muted-foreground text-xs tabular-nums">
                      {zoom.toFixed(1)}x
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                onClick={() => {
                  setCrop({ x: 0, y: 0 });
                  setZoom(1);
                  setCroppedArea(null);
                }}
                variant="outline"
              >
                Reset
              </Button>
              <Button disabled={!croppedArea} onClick={onCropApply}>
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
