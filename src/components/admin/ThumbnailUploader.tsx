import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ImageIcon, Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";

export function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}

const MAX_THUMB_BYTES = 5 * 1024 * 1024;
const ALLOWED_THUMB_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const SIGNED_URL_TTL = 60 * 60 * 24 * 365 * 10;

function extractThumbStoragePath(url: string): string | null {
  if (!url) return null;
  const match = url.match(/\/storage\/v1\/object\/(?:sign|public)\/match-thumbnails\/([^?#]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

async function deleteThumbFromBucket(url: string): Promise<boolean> {
  const path = extractThumbStoragePath(url);
  if (!path) return false;
  const { error } = await supabase.storage.from("match-thumbnails").remove([path]);
  if (error) {
    toast.error(`Failed to delete old image: ${error.message}`);
    return false;
  }
  return true;
}

export function ThumbnailUploader({
  value,
  onChange,
  label = "Thumbnail",
}: {
  value: string;
  onChange: (url: string) => void;
  label?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState<{ file: File; previousUrl: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);

  useEffect(() => {
    setPreviewError(false);
  }, [value]);

  const currentIsBucketObject = !!extractThumbStoragePath(value);

  async function handleFile(file: File) {
    setError(null);
    if (!ALLOWED_THUMB_TYPES.includes(file.type)) {
      const msg = "Unsupported file type. Use JPG, PNG, WebP, or GIF.";
      setError(msg);
      toast.error(msg);
      return;
    }
    if (file.size > MAX_THUMB_BYTES) {
      const msg = `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 5 MB.`;
      setError(msg);
      toast.error(msg);
      return;
    }
    const previousUrl = value;
    if (extractThumbStoragePath(previousUrl)) {
      setConfirmReplace({ file, previousUrl });
      return;
    }
    await doUpload(file, previousUrl);
  }

  async function doUpload(file: File, previousUrl: string) {
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("match-thumbnails")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { data: signed, error: signErr } = await supabase.storage
        .from("match-thumbnails")
        .createSignedUrl(path, SIGNED_URL_TTL);
      if (signErr || !signed?.signedUrl) throw signErr ?? new Error("Failed to sign URL");
      onChange(signed.signedUrl);
      toast.success(`${label} uploaded`);
      if (extractThumbStoragePath(previousUrl)) {
        await deleteThumbFromBucket(previousUrl);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  }

  async function performReplace() {
    if (!confirmReplace) return;
    const { file, previousUrl } = confirmReplace;
    setConfirmReplace(null);
    await doUpload(file, previousUrl);
  }

  async function performDelete() {
    setConfirmDelete(false);
    if (!value) return;
    const isBucket = !!extractThumbStoragePath(value);
    if (isBucket) {
      setDeleting(true);
      const ok = await deleteThumbFromBucket(value);
      setDeleting(false);
      if (!ok) return;
      toast.success(`${label} deleted`);
    }
    onChange("");
  }

  function handleDelete() {
    if (!value) return;
    if (currentIsBucketObject) setConfirmDelete(true);
    else onChange("");
  }

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      <div className="flex flex-col gap-3 rounded-lg border border-arena-border bg-arena-panel-2/40 p-3 sm:flex-row sm:items-start">
        <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black/30 sm:w-56 sm:shrink-0">
          {value && !previewError ? (
            <>
              <img
                src={value}
                alt={`${label} preview`}
                className="h-full w-full object-cover"
                onError={() => setPreviewError(true)}
              />
              <button
                type="button"
                onClick={handleDelete}
                disabled={uploading || deleting}
                className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white hover:bg-black disabled:opacity-60"
                aria-label={currentIsBucketObject ? "Delete thumbnail" : "Remove thumbnail"}
              >
                {deleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}
              </button>
            </>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
              <ImageIcon className="h-6 w-6" />
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
                accept={ALLOWED_THUMB_TYPES.join(",")}
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void handleFile(f);
                }}
              />
              <span
                className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-arena-border bg-arena-panel px-3 text-sm font-semibold hover:bg-arena-panel-2 ${
                  uploading ? "pointer-events-none opacity-60" : ""
                }`}
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {uploading ? "Uploading…" : value ? "Replace image" : "Upload image"}
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
          <Textarea
            rows={2}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="…or paste an image URL"
            className="text-xs"
          />
          <p className="text-[11px] text-muted-foreground">
            JPG, PNG, WebP, or GIF. Max 5 MB. 16:9 recommended.
          </p>
          {error && <p className="text-[11px] text-destructive">{error}</p>}
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this {label.toLowerCase()}?</AlertDialogTitle>
            <AlertDialogDescription>
              The uploaded image will be permanently removed from storage. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={performDelete} disabled={deleting}>
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmReplace} onOpenChange={(v) => !v && setConfirmReplace(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace {label.toLowerCase()}?</AlertDialogTitle>
            <AlertDialogDescription>
              Uploading a replacement will delete the current image from storage. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={performReplace} disabled={uploading}>
              {uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
