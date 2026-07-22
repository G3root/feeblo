import { Avatar, AvatarFallback, AvatarImage } from "@feeblo/ui/avatar";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@feeblo/ui/menu";
import { toastManager } from "@feeblo/ui/toast";
import { Cancel01Icon, Edit01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type * as React from "react";
import { createContext, use, useRef } from "react";

interface SettingsAvatarControlContextValue {
  ariaLabel: string;
  imageAlt: string;
  imageUrl: string | null | undefined;
  name: string;
  onRemove?: (() => Promise<void>) | undefined;
  onUpload: (file: File) => Promise<void>;
  openFileDialog: () => void;
}

const SettingsAvatarControlContext =
  createContext<SettingsAvatarControlContextValue | null>(null);

function useSettingsAvatarControl() {
  const value = use(SettingsAvatarControlContext);

  if (!value) {
    throw new Error(
      "SettingsAvatarControl components must be used within SettingsAvatarControl.Root"
    );
  }

  return value;
}

function Root({
  accept = "image/jpeg,image/png,image/webp",
  ariaLabel,
  children,
  imageAlt,
  imageUrl,
  name,
  onUpload,
  onRemove,
}: {
  accept?: string;
  ariaLabel: string;
  children: React.ReactNode;
  imageAlt: string;
  imageUrl: string | null | undefined;
  name: string;
  onUpload: (file: File) => Promise<void>;
  onRemove?: (() => Promise<void>) | undefined;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      await onUpload(file);
    } finally {
      event.target.value = "";
    }
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
    </SettingsAvatarControlContext>
  );
}

function Button(props: React.ComponentProps<"button">) {
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
        <Avatar>
          {imageUrl ? <AvatarImage alt={imageAlt} src={imageUrl} /> : null}
          <AvatarFallback>
            {name.trim().slice(0, 1).toUpperCase() || "U"}
          </AvatarFallback>
        </Avatar>
      </button>
    </div>
  );
}

function Dropdown({ children }: { children: React.ReactNode }) {
  return <Menu>{children}</Menu>;
}

function DropdownTrigger() {
  return <MenuTrigger render={<Button />} />;
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
  Button,
  Dropdown,
  DropdownTrigger,
  Menu: DropdownMenu,
  ChangeItem,
  RemoveItem,
};
