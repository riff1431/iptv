import { useEffect, useMemo, useRef, useState } from "react";
import { withAuth } from "@/components/RequireAuth";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";
import {
  AlertCircle,
  Check,
  Loader2,
  Save,
  Trash2,
  Upload,
  User as UserIcon,
  X,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminLoadingBlock } from "@/components/admin/AdminStates";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Profile — PGX Arena" },
      { name: "description", content: "Manage your PGX Arena profile." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: withAuth(ProfilePage),
});

const AVATAR_SIGNED_URL_TTL = 60 * 60 * 24 * 365 * 10; // 10 years
const MIN_AVATAR_BYTES = 512; // 0.5 KB — rejects empty or truncated files
const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB
const MIN_AVATAR_DIM = 64; // px
const MAX_AVATAR_DIM = 4096; // px
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
const ACCEPTED_EXT: Record<(typeof ACCEPTED_TYPES)[number], readonly string[]> = {
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
};
const NAME_MIN = 2;
const NAME_MAX = 60;

const profileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(NAME_MIN, { message: `Must be at least ${NAME_MIN} characters` })
    .max(NAME_MAX, { message: `Must be ${NAME_MAX} characters or fewer` }),
  avatarUrl: z
    .string()
    .trim()
    .max(2048, { message: "URL is too long" })
    .url({ message: "Enter a valid URL (https://…)" })
    .or(z.literal(""))
    .optional(),
});

type FieldErrors = { displayName?: string; avatarUrl?: string };

function ProfilePage() {
  const { user, loading: authLoading, isAdmin, refresh } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [initialValues, setInitialValues] = useState<{
    displayName: string;
    avatarUrl: string;
  }>({ displayName: "", avatarUrl: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [pendingValidating, setPendingValidating] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Record<keyof FieldErrors, boolean>>({
    displayName: false,
    avatarUrl: false,
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Revoke preview object URLs when they change or the page unmounts.
  useEffect(() => {
    if (!pendingPreview) return;
    return () => URL.revokeObjectURL(pendingPreview);
  }, [pendingPreview]);


  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      void navigate({ to: "/auth", replace: true });
      return;
    }
    let mounted = true;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle();
      if (!mounted) return;
      const name =
        data?.display_name ??
        (user.user_metadata?.display_name as string | undefined) ??
        user.email?.split("@")[0] ??
        "";
      const url =
        data?.avatar_url ?? (user.user_metadata?.avatar_url as string | undefined) ?? "";
      setDisplayName(name);
      setAvatarUrl(url);
      setAvatarPath(extractAvatarPath(url, user.id));
      setInitialValues({ displayName: name, avatarUrl: url });
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [user, authLoading, navigate]);

  const initial = (displayName || "?").slice(0, 1).toUpperCase();

  const validation = useMemo(
    () => profileSchema.safeParse({ displayName, avatarUrl }),
    [displayName, avatarUrl],
  );

  const liveErrors: FieldErrors = useMemo(() => {
    if (validation.success) return {};
    const out: FieldErrors = {};
    for (const issue of validation.error.issues) {
      const key = issue.path[0] as keyof FieldErrors | undefined;
      if (key && !out[key]) out[key] = issue.message;
    }
    return out;
  }, [validation]);

  // Show live errors only for fields the user has interacted with, plus any
  // errors surfaced by an explicit save attempt.
  const visibleErrors: FieldErrors = {
    displayName: (touched.displayName && liveErrors.displayName) || errors.displayName,
    avatarUrl: (touched.avatarUrl && liveErrors.avatarUrl) || errors.avatarUrl,
  };

  const hasPending = Boolean(pendingFile);
  const isDirty =
    displayName !== initialValues.displayName || avatarUrl !== initialValues.avatarUrl;
  const canSave =
    validation.success && isDirty && !saving && !uploading && !hasPending;
  const canConfirmUpload =
    hasPending && !uploading && !saving && !pendingValidating && !pendingError;

  const clearPending = () => {
    setPendingFile(null);
    setPendingPreview(null);
    setPendingError(null);
    setPendingValidating(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  /**
   * Validate a picked file against strict rules (type, extension, size,
   * decodable image, dimensions) and surface any error inline BEFORE the
   * upload happens. Only files that pass every check become "pending".
   */
  const selectFile = async (file: File) => {
    if (!user) return;
    // Reset any prior pending state — including a preview URL — before we
    // decide whether this new file is valid.
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingFile(null);
    setPendingPreview(null);
    setPendingError(null);
    setErrors((e) => ({ ...e, avatarUrl: undefined }));

    const acceptedList = ACCEPTED_TYPES as readonly string[];
    const setInvalid = (message: string) => {
      setPendingError(message);
      setPendingValidating(false);
    };

    if (!file.type || !acceptedList.includes(file.type)) {
      setInvalid(
        `Unsupported file type${file.type ? ` (${file.type})` : ""}. Use PNG, JPEG, WEBP, or GIF.`,
      );
      return;
    }
    const mime = file.type as (typeof ACCEPTED_TYPES)[number];
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!ext || !ACCEPTED_EXT[mime].includes(ext)) {
      setInvalid(
        `File extension ".${ext || "?"}" doesn't match ${mime}. Rename the file or pick another.`,
      );
      return;
    }
    if (file.size < MIN_AVATAR_BYTES) {
      setInvalid("File is too small or empty — pick a real image.");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setInvalid(
        `Image is ${formatBytes(file.size)}. Max size is ${formatBytes(MAX_AVATAR_BYTES)}.`,
      );
      return;
    }

    // Confirm the bytes actually decode as an image and check dimensions.
    setPendingValidating(true);
    const previewUrl = URL.createObjectURL(file);
    const dims = await measureImage(previewUrl);
    if (!dims) {
      URL.revokeObjectURL(previewUrl);
      setInvalid("This file isn't a readable image. Try another file.");
      return;
    }
    if (dims.width < MIN_AVATAR_DIM || dims.height < MIN_AVATAR_DIM) {
      URL.revokeObjectURL(previewUrl);
      setInvalid(
        `Image is ${dims.width}×${dims.height}px. Minimum is ${MIN_AVATAR_DIM}×${MIN_AVATAR_DIM}px.`,
      );
      return;
    }
    if (dims.width > MAX_AVATAR_DIM || dims.height > MAX_AVATAR_DIM) {
      URL.revokeObjectURL(previewUrl);
      setInvalid(
        `Image is ${dims.width}×${dims.height}px. Maximum is ${MAX_AVATAR_DIM}×${MAX_AVATAR_DIM}px.`,
      );
      return;
    }

    setPendingFile(file);
    setPendingPreview(previewUrl);
    setPendingValidating(false);
  };

  /** Upload the pending file to storage and adopt it as the saved avatar URL. */
  const confirmUpload = async () => {
    if (!user || !pendingFile) return;
    const file = pendingFile;
    setUploading(true);
    const uploadToast = toast.loading("Uploading avatar…");
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || file.type.split("/")[1] || "png";
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type, cacheControl: "3600" });
      if (upErr) throw upErr;

      const { data: signed, error: signErr } = await supabase.storage
        .from("avatars")
        .createSignedUrl(path, AVATAR_SIGNED_URL_TTL);
      if (signErr || !signed) throw signErr ?? new Error("Could not sign URL");

      if (avatarPath && avatarPath !== path) {
        void supabase.storage.from("avatars").remove([avatarPath]);
      }

      setAvatarUrl(signed.signedUrl);
      setAvatarPath(path);
      clearPending();
      toast.success("Avatar ready", {
        id: uploadToast,
        description: "Click Save to apply your changes.",
      });
    } catch (err) {
      toast.error("Upload failed", {
        id: uploadToast,
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setUploading(false);
    }
  };

  const removeAvatar = () => {
    if (avatarPath) {
      void supabase.storage.from("avatars").remove([avatarPath]);
    }
    setAvatarUrl("");
    setAvatarPath(null);
    setErrors((e) => ({ ...e, avatarUrl: undefined }));
  };


  const save = async () => {
    if (!user) return;
    setTouched({ displayName: true, avatarUrl: true });
    const parsed = profileSchema.safeParse({ displayName, avatarUrl });
    if (!parsed.success) {
      const out: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof FieldErrors | undefined;
        if (key && !out[key]) out[key] = issue.message;
      }
      setErrors(out);
      toast.error("Please fix the highlighted fields");
      return;
    }
    setErrors({});
    setSaving(true);
    const saveToast = toast.loading("Saving profile…");
    const payload = {
      id: user.id,
      display_name: parsed.data.displayName,
      avatar_url: parsed.data.avatarUrl ? parsed.data.avatarUrl : null,
    };
    const { error } = await supabase.from("profiles").upsert(payload);
    if (error) {
      toast.error("Could not save profile", {
        id: saveToast,
        description: error.message,
      });
      setSaving(false);
      return;
    }
    const { error: authErr } = await supabase.auth.updateUser({
      data: { display_name: payload.display_name, avatar_url: payload.avatar_url },
    });
    if (authErr) {
      // Profile row saved; just warn that the auth metadata didn't sync.
      toast.warning("Profile saved with a warning", {
        id: saveToast,
        description: `Account metadata didn't update: ${authErr.message}`,
      });
    } else {
      toast.success("Profile saved", {
        id: saveToast,
        description: "Your changes are live.",
      });
    }
    await refresh();
    setInitialValues({
      displayName: parsed.data.displayName,
      avatarUrl: parsed.data.avatarUrl ?? "",
    });
    setSaving(false);
  };

  const resetChanges = () => {
    setDisplayName(initialValues.displayName);
    setAvatarUrl(initialValues.avatarUrl);
    setAvatarPath(user ? extractAvatarPath(initialValues.avatarUrl, user.id) : null);
    setErrors({});
    setTouched({ displayName: false, avatarUrl: false });
  };

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-2xl px-4 py-8">
        <div className="mb-6 flex items-center gap-2">
          <UserIcon className="h-5 w-5 text-arena-violet" />
          <h1 className="text-lg font-bold uppercase tracking-widest text-white">
            Your Profile
          </h1>
          {isAdmin && (
            <span className="rounded-sm bg-primary/20 px-1.5 py-[1px] text-[10px] font-bold uppercase tracking-wider text-primary">
              Admin
            </span>
          )}
        </div>

        {authLoading || loading ? (
          <AdminLoadingBlock label="Loading profile" />
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
            className="space-y-6 rounded-lg border border-arena-border bg-arena-panel/40 p-6"
            noValidate
          >
            <div className="flex items-start gap-4">
              <div className="relative shrink-0">
                <span className="grid h-16 w-16 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-arena-violet to-arena-cyan text-xl font-bold text-white">
                  {pendingPreview ? (
                    <img
                      src={pendingPreview}
                      alt="Selected avatar preview"
                      className="h-full w-full object-cover"
                    />
                  ) : avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      onError={() =>
                        setErrors((e) => ({
                          ...e,
                          avatarUrl: "Image failed to load. Try another file or URL.",
                        }))
                      }
                    />
                  ) : (
                    initial
                  )}
                </span>
                {pendingPreview && (
                  <span
                    className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-arena-violet px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-wider text-white shadow"
                    aria-hidden="true"
                  >
                    Preview
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-white">
                  {displayName || "Unnamed player"}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {user?.email}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_TYPES.join(",")}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void selectFile(f);
                  }}
                />
                {hasPending ? (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className="gap-2"
                        disabled={!canConfirmUpload}
                        onClick={() => void confirmUpload()}
                        aria-busy={uploading}
                      >
                        {uploading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {uploading ? "Uploading…" : "Confirm upload"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="gap-2"
                        disabled={uploading || saving}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                        Choose different
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="gap-2 text-muted-foreground"
                        disabled={uploading || saving}
                        onClick={clearPending}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                        Cancel
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Selected: <span className="text-white">{pendingFile?.name}</span>{" "}
                      ({formatBytes(pendingFile?.size ?? 0)})
                    </p>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={pendingError ? "arenaOutline" : "secondary"}
                      className="gap-2"
                      disabled={uploading || saving || pendingValidating}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                      {pendingError
                        ? "Try another file"
                        : avatarUrl
                          ? "Change photo"
                          : "Upload photo"}
                    </Button>
                    {avatarUrl && !pendingError && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="gap-2 text-muted-foreground hover:text-destructive"
                        onClick={removeAvatar}
                        disabled={saving}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Remove
                      </Button>
                    )}
                  </div>
                )}

                <p className="mt-1 text-[11px] text-muted-foreground">
                  PNG, JPEG, WEBP, or GIF · {formatBytes(MIN_AVATAR_BYTES)}–
                  {formatBytes(MAX_AVATAR_BYTES)} · {MIN_AVATAR_DIM}–{MAX_AVATAR_DIM}px per side.
                </p>
                {pendingValidating && (
                  <p
                    className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground"
                    aria-live="polite"
                  >
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    Checking image…
                  </p>
                )}
                {pendingError && (
                  <p
                    className="mt-1 flex items-start gap-1 text-[11px] text-destructive"
                    role="alert"
                  >
                    <AlertCircle className="mt-[1px] h-3 w-3 shrink-0" aria-hidden="true" />
                    <span>{pendingError}</span>
                  </p>
                )}
                {!pendingError && visibleErrors.avatarUrl && (
                  <p
                    className="mt-1 flex items-center gap-1 text-[11px] text-destructive"
                    role="alert"
                  >
                    <AlertCircle className="h-3 w-3" aria-hidden="true" />
                    {visibleErrors.avatarUrl}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="displayName"
                  className="text-[10px] uppercase tracking-widest text-muted-foreground"
                >
                  Display name
                </Label>
                <span
                  className={cn(
                    "text-[10px] tabular-nums",
                    displayName.length > NAME_MAX
                      ? "text-destructive"
                      : "text-muted-foreground",
                  )}
                  aria-live="polite"
                >
                  {displayName.length}/{NAME_MAX}
                </span>
              </div>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, displayName: true }))}
                maxLength={NAME_MAX + 20}
                placeholder="Your name"
                aria-invalid={Boolean(visibleErrors.displayName)}
                aria-describedby={
                  visibleErrors.displayName ? "displayName-error" : undefined
                }
                className={cn(
                  visibleErrors.displayName &&
                    "border-destructive focus-visible:ring-destructive/40",
                )}
                disabled={saving}
              />
              {visibleErrors.displayName && (
                <p
                  id="displayName-error"
                  className="flex items-center gap-1 text-[11px] text-destructive"
                  role="alert"
                >
                  <AlertCircle className="h-3 w-3" aria-hidden="true" />
                  {visibleErrors.displayName}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {isDirty && !saving && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={resetChanges}
                  disabled={saving || uploading}
                >
                  Discard
                </Button>
              )}
              <Button
                type="submit"
                disabled={!canSave}
                aria-busy={saving}
                className="gap-2"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="h-4 w-4" aria-hidden="true" />
                )}
                {saving ? "Saving…" : isDirty ? "Save changes" : "Saved"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </AppShell>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Load a URL as an <img> and resolve its natural dimensions, or null on decode failure. */
function measureImage(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}


function extractAvatarPath(url: string, userId: string): string | null {
  if (!url) return null;
  const marker = "/avatars/";
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const after = url.slice(idx + marker.length).split("?")[0];
  return after.startsWith(`${userId}/`) ? after : null;
}
