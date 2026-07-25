import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildSiteHeadTags,
  renderLinkTag,
  renderMetaTag,
} from "@/lib/site-head-tags";
import type { SiteSettings } from "@/lib/site-settings.functions";

export function HeadTagsPreview({
  settings,
}: {
  settings: Partial<SiteSettings>;
}) {
  const [copied, setCopied] = useState(false);

  const html = useMemo(() => {
    const { meta, links } = buildSiteHeadTags(settings, { buildId: "PREVIEW" });
    const lines: string[] = [];
    for (const m of meta) lines.push(renderMetaTag(m));
    for (const l of links) lines.push(renderLinkTag(l));
    return lines.join("\n");
  }, [settings]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(html);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          Live preview of the exact <code>&lt;head&gt;</code> tags rendered on
          every page. Updates as you type — not saved yet.
        </p>
        <Button type="button" size="sm" variant="outline" onClick={handleCopy}>
          {copied ? (
            <>
              <Check className="mr-1 h-3.5 w-3.5" /> Copied
            </>
          ) : (
            <>
              <Copy className="mr-1 h-3.5 w-3.5" /> Copy
            </>
          )}
        </Button>
      </div>
      <pre className="max-h-[360px] overflow-auto rounded-md border border-border bg-black/60 p-3 text-[11px] leading-relaxed text-emerald-200">
        <code>{html}</code>
      </pre>
    </div>
  );
}
