import { Loader2, Inbox, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Standardized loading/empty states for admin surfaces.
// - AdminLoadingRow / AdminEmptyRow: for use inside <tbody> (auto-fills colSpan).
// - AdminLoadingBlock / AdminEmptyBlock: for card/list surfaces (no <table>).
// All variants share the same arena-styled visual language so every admin
// screen tells the user the same story while data is fetching or absent.

export function AdminLoadingRow({
  colSpan,
  label = "Loading…",
}: {
  colSpan: number;
  label?: string;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10">
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-arena-violet" />
          <span className="uppercase tracking-wider">{label}</span>
        </div>
      </td>
    </tr>
  );
}

export function AdminEmptyRow({
  colSpan,
  icon: Icon = Inbox,
  title,
  description,
}: {
  colSpan: number;
  icon?: LucideIcon;
  title: string;
  description?: string;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12">
        <AdminEmptyInner icon={Icon} title={title} description={description} />
      </td>
    </tr>
  );
}

export function AdminLoadingBlock({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground",
        className,
      )}
    >
      <Loader2 className="h-4 w-4 animate-spin text-arena-violet" />
      <span className="uppercase tracking-wider">{label}</span>
    </div>
  );
}

export function AdminEmptyBlock({
  icon = Inbox,
  title,
  description,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cn("p-10", className)}>
      <AdminEmptyInner icon={icon} title={title} description={description} />
    </div>
  );
}

export function AdminErrorBlock({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive",
        className,
      )}
      role="alert"
    >
      {message}
    </div>
  );
}

function AdminEmptyInner({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
}) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-arena-border bg-arena-panel-2/60 text-arena-violet">
        <Icon className="h-5 w-5" />
      </div>
      <div className="font-display text-sm font-bold uppercase tracking-wider text-white">
        {title}
      </div>
      {description ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
