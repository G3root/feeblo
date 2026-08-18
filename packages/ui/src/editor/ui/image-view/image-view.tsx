import { UploadTask } from "prosekit/extensions/file";
import type { ImageAttrs } from "prosekit/extensions/image";
import type { ReactNodeViewProps } from "prosekit/react";
import { ResizableHandle, ResizableRoot } from "prosekit/react/resizable";
import { type SyntheticEvent, useEffect, useState } from "react";

export default function ImageView(props: ReactNodeViewProps) {
  // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
  const attrs = props.node.attrs as ImageAttrs;
  const url = attrs.src || "";
  const uploadTask = url.startsWith("blob:")
    ? UploadTask.get<string>(url)
    : undefined;
  const uploading = Boolean(uploadTask);

  const [aspectRatio, setAspectRatio] = useState<number | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!uploading) {
      return;
    }

    if (!uploadTask) {
      return;
    }

    let canceled = false;

    uploadTask.finished.catch((error) => {
      if (canceled) {
        return;
      }
      setError(String(error));
    });
    const unsubscribeProgress = uploadTask.subscribeProgress(
      ({ loaded, total }) => {
        if (canceled) {
          return;
        }
        setProgress(total ? loaded / total : 0);
      }
    );

    return () => {
      canceled = true;
      unsubscribeProgress();
    };
  }, [url, uploading]);

  const handleImageLoad = (event: SyntheticEvent) => {
    // SAFETY: The event target is the expected DOM element type for this handler.
    const img = event.target as HTMLImageElement;
    const { naturalWidth, naturalHeight } = img;
    const ratio = naturalWidth / naturalHeight;
    if (ratio && Number.isFinite(ratio)) {
      setAspectRatio(ratio);
    }
    if (naturalWidth && naturalHeight && !(attrs.width && attrs.height)) {
      props.setAttrs({ width: naturalWidth, height: naturalHeight });
    }
  };

  return (
    <ResizableRoot
      aspectRatio={aspectRatio ?? null}
      className="group data-selected:outline-primary relative my-2 box-border flex max-h-150 min-h-16 max-w-full min-w-16 items-center justify-center overflow-hidden outline-2 outline-transparent outline-solid"
      data-selected={props.selected ? "" : undefined}
      height={attrs.height ?? null}
      onResizeEnd={(event) => props.setAttrs(event.detail)}
      width={attrs.width ?? null}
    >
      {url && !error && (
        <img
          alt="upload preview"
          className="h-full max-h-full w-full max-w-full object-contain"
          onLoad={handleImageLoad}
          src={url}
        />
      )}
      {uploading && !error && (
        <div className="bg-foreground/60 text-background/80 absolute start-0 bottom-0 m-1 flex content-center items-center gap-2 rounded-sm p-1.5 text-xs transition">
          <div className="i-lucide-loader-circle block size-4 animate-spin" />
          <div>{Math.round(progress * 100)}%</div>
        </div>
      )}
      {error && (
        <div className="bg-muted @container absolute start-0 end-0 top-0 bottom-0 flex flex-col items-center justify-center gap-4 p-2 text-sm">
          <div className="i-lucide-image-off block size-8" />
          <div className="hidden opacity-80 @xs:block">
            Failed to upload image
          </div>
        </div>
      )}
      <ResizableHandle
        className="bg-foreground/30 text-background/50 hover:bg-foreground/60 active:bg-foreground/60 active:text-background/80 absolute end-0 bottom-0 m-1.5 rounded-sm p-1 opacity-0 transition group-hover:opacity-100 group-data-resizing:opacity-100 hover:opacity-100 active:translate-x-0.5 active:translate-y-0.5 rtl:active:-translate-x-0.5"
        position="bottom-right"
      >
        <div className="i-lucide-arrow-down-right block size-4" />
      </ResizableHandle>
    </ResizableRoot>
  );
}
