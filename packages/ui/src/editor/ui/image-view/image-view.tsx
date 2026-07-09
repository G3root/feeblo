import { UploadTask } from "prosekit/extensions/file";
import type { ImageAttrs } from "prosekit/extensions/image";
import type { ReactNodeViewProps } from "prosekit/react";
import { ResizableHandle, ResizableRoot } from "prosekit/react/resizable";
import { type SyntheticEvent, useEffect, useState } from "react";

export default function ImageView(props: ReactNodeViewProps) {
  const attrs = props.node.attrs as ImageAttrs;
  const url = attrs.src || "";
  const uploading = url.startsWith("blob:");

  const [aspectRatio, setAspectRatio] = useState<number | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!uploading) {
      return;
    }

    const uploadTask = UploadTask.get<string>(url);
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
      aspectRatio={aspectRatio}
      className="group relative my-2 box-border flex max-h-150 min-h-16 min-w-16 max-w-full items-center justify-center overflow-hidden outline-2 outline-solid outline-transparent data-selected:outline-primary"
      data-selected={props.selected ? "" : undefined}
      height={attrs.height ?? undefined}
      onResizeEnd={(event) => props.setAttrs(event.detail)}
      width={attrs.width ?? undefined}
    >
      {url && !error && (
        // biome-ignore lint/a11y/noNoninteractiveElementInteractions: <explanation>
        // biome-ignore lint/correctness/useImageSize: <explanation>
        <img
          alt="upload preview"
          className="h-full max-h-full w-full max-w-full object-contain"
          onLoad={handleImageLoad}
          src={url}
        />
      )}
      {uploading && !error && (
        <div className="absolute start-0 bottom-0 m-1 flex content-center items-center gap-2 rounded-sm bg-foreground/60 p-1.5 text-background/80 text-xs transition">
          <div className="i-lucide-loader-circle block size-4 animate-spin" />
          <div>{Math.round(progress * 100)}%</div>
        </div>
      )}
      {error && (
        <div className="@container absolute start-0 end-0 top-0 bottom-0 flex flex-col items-center justify-center gap-4 bg-muted p-2 text-sm">
          <div className="i-lucide-image-off block size-8" />
          <div className="@xs:block hidden opacity-80">
            Failed to upload image
          </div>
        </div>
      )}
      <ResizableHandle
        className="absolute end-0 bottom-0 m-1.5 rounded-sm bg-foreground/30 p-1 text-background/50 opacity-0 transition hover:bg-foreground/60 hover:opacity-100 active:translate-x-0.5 active:translate-y-0.5 active:bg-foreground/60 active:text-background/80 group-hover:opacity-100 group-data-resizing:opacity-100 rtl:active:-translate-x-0.5"
        position="bottom-right"
      >
        <div className="i-lucide-arrow-down-right block size-4" />
      </ResizableHandle>
    </ResizableRoot>
  );
}
