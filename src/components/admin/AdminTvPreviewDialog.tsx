import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { HlsTile } from "@/components/sports-arena/HlsTile";

/**
 * Admin-only preview that plays a TV's shared stream through the same
 * custom player (`HlsTile`) that arena viewers see. It hits the signed
 * `/api/sports-arena/tv/:tvId/playlist` proxy with the admin's bearer
 * token, so no upstream credentials leak into the browser.
 *
 * The tile is scoped to a single TV — starting the stream affects ONLY
 * that screen's `tv_stream_sessions` row.
 */
export function AdminTvPreviewDialog({
  open,
  onOpenChange,
  tvId,
  slot,
  displayName,
  channelName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tvId: string;
  slot: number;
  displayName: string | null;
  channelName: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Now playing on TV {slot}
            {displayName ? ` — ${displayName}` : ""}
          </DialogTitle>
          <DialogDescription>
            Live preview of this screen only. Uses the custom player and the
            signed lounge proxy.
          </DialogDescription>
        </DialogHeader>

        {open && (
          <div className="overflow-hidden rounded-md">
            <HlsTile
              tvId={tvId}
              slot={slot}
              displayName={displayName}
              channelName={channelName}
              status="online"
              active
              onActivate={() => {}}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
