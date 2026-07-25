import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type Status =
  | { kind: "loading"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export function StreamPreviewDialog({
  open,
  onOpenChange,
  url,
  title,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  url: string;
  title?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "loading", message: "Connecting…" });

  useEffect(() => {
    if (!open || !url) return;
    const video = videoRef.current;
    if (!video) return;

    setStatus({ kind: "loading", message: "Connecting…" });

    const isHls = /\.m3u8(\?|$)/i.test(url);
    let cancelled = false;

    const onCanPlay = () => {
      if (cancelled) return;
      setStatus({ kind: "success", message: "Stream loaded successfully" });
      video.play().catch(() => {
        /* autoplay may be blocked; still counts as loaded */
      });
    };
    const onError = () => {
      if (cancelled) return;
      setStatus({
        kind: "error",
        message: "Playback failed — the stream may be offline or blocked by CORS.",
      });
    };

    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("error", onError);

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (cancelled) return;
        setStatus({ kind: "success", message: "Stream loaded successfully" });
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (cancelled || !data.fatal) return;
        setStatus({
          kind: "error",
          message: `Stream error: ${data.details ?? data.type}`,
        });
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else {
      video.src = url;
      video.load();
    }

    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      setStatus((s) =>
        s.kind === "loading"
          ? { kind: "error", message: "Timed out waiting for stream." }
          : s,
      );
    }, 15000);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("error", onError);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.removeAttribute("src");
      video.load();
    };
  }, [open, url]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Stream preview{title ? ` — ${title}` : ""}</DialogTitle>
          <DialogDescription className="truncate">{url || "No URL"}</DialogDescription>
        </DialogHeader>

        <div className="overflow-hidden rounded-md border border-border bg-black">
          <video
            ref={videoRef}
            controls
            muted
            playsInline
            className="aspect-video w-full bg-black"
          />
        </div>

        <div
          className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
            status.kind === "success"
              ? "border-success/40 bg-success/10 text-success"
              : status.kind === "error"
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-border bg-muted/30 text-muted-foreground"
          }`}
        >
          {status.kind === "loading" ? (
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
          ) : status.kind === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{status.message}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
