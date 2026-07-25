import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ImageIcon, Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "site-assets";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
];
const SIGNED_URL_TTL = 60 * 60 * 24 * 365 * 10;

function extractStoragePath(url: string): string | null {
  if (!url) return null;
  const match = url.match(
    new RegExp(`/storage/v1/object/(?:sign|public)/${BUCKET}/([^?#]+)`),
  );
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

async function deleteFromBucket(url: string): Promise<boolean> {
  const path = extractStoragePath(url);
  if (!path) return false;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) {
    toast.error(`Failed to delete old asset: ${error.message}`);
    return false;
  }
  return true;
}

type PreviewShape = "logo" | "favicon" | "og";

const SHAPE_CLASSES: Record<PreviewShape, string> = {
  logo: "h-16 w-auto max-w-[220px] object-contain bg-black/20",
  favicon: "h-12 w-12 object-contain bg-black/20",
  og: "h-32 w-full max-w-[320px] object-cover",
};

export function SiteAssetUploader({
  value,
  onChange,
  folder,
  shape = "logo",
  placeholder,
  accept,
  hint,
}: {
  value: string;
  onChange: (url: string) => void;
  folder: string;
  shape?: PreviewShape;
  placeholder?: string;
  accept?: string;
  hint?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);

  useEffect(() => {
    setPreviewError(false);
  }, [value]);

  const currentIsBucketObject = !!extractStoragePath(value);

  async function handleFile(file: File) {
    setError(null);
    if (!ALLOWED_TYPES.includes(file.type)) {
      const msg = "Unsupported file type. Use JPG, PNG, WebP, GIF, SVG, or ICO.";
      setError(msg);
      toast.error(msg);
      return;
    }
    if (file.size > MAX_BYTES) {
      const msg = `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 5 MB.`;
      setError(msg);
      toast.error(msg);
      return;
    }
    const previousUrl = value;
    setUploading(true);
    try {
      const extFromName = file.name.split(".").pop()?.toLowerCase();
      const ext = extFromName || file.type.split("/").pop() || "png";
      const path = `${folder}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { data: signed, error: signErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, SIGNED_URL_TTL);
      if (signErr || !signed?.signedUrl) throw signErr ?? new Error("Failed to sign URL");
      onChange(signed.signedUrl);
      toast.success("Asset uploaded");
      if (extractStoragePath(previousUrl)) {
        await deleteFromBucket(previousUrl);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete() {
    if (!value) return;
    if (currentIsBucketObject) {
      setDeleting(true);
      const ok = await deleteFromBucket(value);
      setDeleting(false);
      if (!ok) return;
      toast.success("Asset removed");
    }
    onChange("");
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-background/40 p-3 sm:flex-row sm:items-start">
      <div className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/60">
        {value && !previewError ? (
          <>
            <img
              src={value}
              alt="Asset preview"
              className={SHAPE_CLASSES[shape]}
              onError={() => setPreviewError(true)}
            />
            <button
              type="button"
              onClick={handleDelete}
              disabled={uploading || deleting}
              className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white hover:bg-black disabled:opacity-60"
              aria-label={currentIsBucketObject ? "Delete asset" : "Remove asset"}
            >
              {deleting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <X className="h-3 w-3" />
              )}
            </button>
          </>
        ) : (
          <div
            className={`flex flex-col items-center justify-center gap-1 text-muted-foreground ${SHAPE_CLASSES[shape]}`}
          >
            <ImageIcon className="h-5 w-5" />
            <span className="text-[10px] uppercase tracking-wider">
              {previewError ? "Preview failed" : "No image"}
            </span>
          </div>
        )}
      </div>
      <div className="flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex">
            <input
              type="file"
              accept={accept ?? ALLOWED_TYPES.join(",")}
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void handleFile(f);
              }}
            />
            <span
              className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm font-semibold hover:bg-muted/70 ${
                uploading ? "pointer-events-none opacity-60" : ""
              }`}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {uploading ? "Uploading…" : value ? "Replace" : "Upload"}
            </span>
          </label>
          {value && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleDelete}
              disabled={uploading || deleting}
            >
              {deleting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              {currentIsBucketObject ? "Delete" : "Clear"}
            </Button>
          )}
        </div>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? "…or paste an image URL"}
          className="text-xs"
        />
        {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
        {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}
