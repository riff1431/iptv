import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getSiteSettings,
  updateSiteSettings,
  type SiteSettings,
} from "@/lib/site-settings.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SiteAssetUploader } from "@/components/admin/SiteAssetUploader";
import { HeadTagsPreview } from "@/components/admin/HeadTagsPreview";

export const Route = createFileRoute("/admin/site-settings")({
  component: SiteSettingsPage,
});

type FormState = {
  site_name: string;
  meta_title: string;
  meta_description: string;
  logo_url: string;
  favicon_url: string;
  og_image_url: string;
  twitter_handle: string;
};

// Hard limits mirror the server-side zod schema — going over blocks save.
// Ideal limits are SEO best practice — going over shows a soft warning.
const LIMITS = {
  site_name: { min: 1, max: 120, ideal: 60 },
  meta_title: { min: 1, max: 160, ideal: 60 },
  meta_description: { min: 1, max: 320, ideal: 160 },
} as const;

type FieldKey = keyof typeof LIMITS;

const LABELS: Record<FieldKey, string> = {
  site_name: "Website name",
  meta_title: "Meta title",
  meta_description: "Meta description",
};

function validateField(key: FieldKey, raw: string): string | null {
  const value = raw.trim();
  const { min, max } = LIMITS[key];
  if (value.length < min) return `${LABELS[key]} is required.`;
  if (raw.length > max) return `${LABELS[key]} must be ${max} characters or fewer (currently ${raw.length}).`;
  return null;
}

function toForm(s: SiteSettings): FormState {
  return {
    site_name: s.site_name,
    meta_title: s.meta_title,
    meta_description: s.meta_description,
    logo_url: s.logo_url ?? "",
    favicon_url: s.favicon_url ?? "",
    og_image_url: s.og_image_url ?? "",
    twitter_handle: s.twitter_handle ?? "",
  };
}

function SiteSettingsPage() {
  const getFn = useServerFn(getSiteSettings);
  const updateFn = useServerFn(updateSiteSettings);
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "site-settings"],
    queryFn: () => getFn({}),
  });

  const [form, setForm] = useState<FormState | null>(null);
  const [touched, setTouched] = useState<Record<FieldKey, boolean>>({
    site_name: false,
    meta_title: false,
    meta_description: false,
  });

  useEffect(() => {
    if (data && !form) setForm(toForm(data));
  }, [data, form]);

  const errors = useMemo(() => {
    if (!form) return null;
    return {
      site_name: validateField("site_name", form.site_name),
      meta_title: validateField("meta_title", form.meta_title),
      meta_description: validateField("meta_description", form.meta_description),
    } as Record<FieldKey, string | null>;
  }, [form]);

  const hasErrors = !!errors && Object.values(errors).some((e) => e !== null);

  const router = useRouter();
  const mutation = useMutation({
    mutationFn: (payload: FormState) => updateFn({ data: payload }),
    onSuccess: (res) => {
      toast.success("Site settings saved");
      setForm(toForm(res));
      setTouched({ site_name: false, meta_title: false, meta_description: false });
      qc.invalidateQueries({ queryKey: ["admin", "site-settings"] });
      qc.invalidateQueries({ queryKey: ["site-settings"] });
      // Bust the cached root loader so head tags update immediately.
      void router.invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Failed to save"),
  });

  if (isLoading || !form) {
    return <div className="text-sm text-muted-foreground">Loading site settings…</div>;
  }
  if (error) {
    return <div className="text-sm text-destructive">Failed to load: {(error as Error).message}</div>;
  }

  const bindText = (key: FieldKey) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [key]: e.target.value }),
    onBlur: () => setTouched((t) => ({ ...t, [key]: true })),
    "aria-invalid": errors?.[key] ? true : undefined,
  });

  function handleSave() {
    if (!form) return;
    setTouched({ site_name: true, meta_title: true, meta_description: true });
    if (hasErrors && errors) {
      const first = (Object.keys(errors) as FieldKey[]).find((k) => errors[k]);
      if (first) toast.error(errors[first] ?? "Please fix the highlighted fields.");
      return;
    }
    mutation.mutate(form);
  }

  return (
    <div className="space-y-6">
      <Card className="arena-card">
        <CardHeader>
          <CardTitle>General Site Settings</CardTitle>
          <CardDescription>
            Control your site name, meta tags, and brand assets. Changes apply site-wide.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <ValidatedField
              label="Website name"
              value={form.site_name}
              limits={LIMITS.site_name}
              error={touched.site_name ? errors?.site_name ?? null : null}
            >
              <Input {...bindText("site_name")} maxLength={LIMITS.site_name.max} />
            </ValidatedField>
            <Field label="Twitter handle" hint="e.g. @playgroundx">
              <Input
                value={form.twitter_handle}
                onChange={(e) => setForm({ ...form, twitter_handle: e.target.value })}
                maxLength={64}
                placeholder="@yourhandle"
              />
            </Field>
          </div>

          <ValidatedField
            label="Meta title"
            value={form.meta_title}
            limits={LIMITS.meta_title}
            error={touched.meta_title ? errors?.meta_title ?? null : null}
            hint="Shown in browser tabs and search results. Aim for 60 characters or fewer."
          >
            <Input {...bindText("meta_title")} maxLength={LIMITS.meta_title.max} />
          </ValidatedField>

          <ValidatedField
            label="Meta description"
            value={form.meta_description}
            limits={LIMITS.meta_description}
            error={touched.meta_description ? errors?.meta_description ?? null : null}
            hint="Shown in search snippets and social shares. Aim for 160 characters or fewer."
          >
            <Textarea {...bindText("meta_description")} rows={3} maxLength={LIMITS.meta_description.max} />
          </ValidatedField>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Logo" hint="Shown in your site header. PNG, SVG, or WebP.">
              <SiteAssetUploader
                value={form.logo_url}
                onChange={(url) => setForm({ ...form, logo_url: url })}
                folder="logo"
                shape="logo"
                placeholder="https://…/logo.png"
              />
            </Field>
            <Field label="Favicon" hint="32×32 PNG or SVG recommended.">
              <SiteAssetUploader
                value={form.favicon_url}
                onChange={(url) => setForm({ ...form, favicon_url: url })}
                folder="favicon"
                shape="favicon"
                placeholder="https://…/favicon.png"
              />
            </Field>
          </div>

          <Field label="Social preview image (og:image)" hint="1200×630 recommended. Used for Open Graph and Twitter cards.">
            <SiteAssetUploader
              value={form.og_image_url}
              onChange={(url) => setForm({ ...form, og_image_url: url })}
              folder="og"
              shape="og"
              placeholder="https://…/og.jpg"
            />
          </Field>

          <div className="flex items-center justify-between border-t border-border pt-4">
            <div className="text-xs text-muted-foreground">
              {data?.updated_at
                ? `Last updated ${new Date(data.updated_at).toLocaleString()}`
                : "Not yet saved"}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  if (data) setForm(toForm(data));
                  setTouched({ site_name: false, meta_title: false, meta_description: false });
                }}
                disabled={mutation.isPending}
              >
                Reset
              </Button>
              <Button
                onClick={handleSave}
                disabled={mutation.isPending || hasErrors}
                title={hasErrors ? "Fix the highlighted fields to save" : undefined}
              >
                {mutation.isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="arena-card">
        <CardHeader>
          <CardTitle>Head tags preview</CardTitle>
          <CardDescription>
            Exactly what will render inside <code>&lt;head&gt;</code> on the
            root route with your current (unsaved) values.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <HeadTagsPreview
            settings={{
              site_name: form.site_name,
              meta_title: form.meta_title,
              meta_description: form.meta_description,
              logo_url: form.logo_url || null,
              favicon_url: form.favicon_url || null,
              og_image_url: form.og_image_url || null,
              twitter_handle: form.twitter_handle || null,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function ValidatedField({
  label,
  value,
  limits,
  error,
  hint,
  children,
}: {
  label: string;
  value: string;
  limits: { min: number; max: number; ideal: number };
  error: string | null;
  hint?: string;
  children: React.ReactNode;
}) {
  const len = value.length;
  const overHard = len > limits.max;
  const overIdeal = !overHard && len > limits.ideal;
  const counterClass = error || overHard
    ? "text-destructive"
    : overIdeal
      ? "text-amber-500"
      : "text-muted-foreground";
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </Label>
        <span className={`text-[11px] tabular-nums ${counterClass}`}>
          {len}/{limits.max}
          {overIdeal && !error ? ` · over ideal ${limits.ideal}` : ""}
        </span>
      </div>
      {children}
      {error ? (
        <p role="alert" className="text-[11px] text-destructive">
          {error}
        </p>
      ) : overIdeal ? (
        <p className="text-[11px] text-amber-500">
          Longer than the recommended {limits.ideal} characters — search engines may truncate it.
        </p>
      ) : hint ? (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
