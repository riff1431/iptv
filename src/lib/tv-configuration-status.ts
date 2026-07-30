export type TvConfigurationStatus = "unconfigured" | "configured" | "disabled";

type TvConfigurationInput = {
  selected_channel_id?: string | null;
  enabled?: boolean | null;
};

/**
 * TV configuration and stream health are separate concerns.
 *
 * `tvs.status` is a legacy field that is not maintained by the shared-stream
 * session flow. A saved channel id is the authoritative signal that a TV is
 * configured; live/stopped/error is shown by `tv_stream_sessions`.
 */
export function getTvConfigurationStatus(
  tv: TvConfigurationInput | null | undefined,
): TvConfigurationStatus {
  if (!tv?.selected_channel_id?.trim()) return "unconfigured";
  return tv.enabled === false ? "disabled" : "configured";
}

export function getSelectedChannelSourceLabel(input: {
  channelId?: string | null;
  connectionType?: "xtream" | "m3u" | "hls" | null;
  streamUrl?: string | null;
}): string {
  const channelId = input.channelId?.trim();
  if (!channelId) return "Pick a channel from the configured provider";
  if (input.streamUrl?.trim()) return `${channelId} · stream override ready`;
  if (input.connectionType === "xtream") {
    return `${channelId} · Xtream stream derived from provider`;
  }
  return `${channelId} · provider stream selected`;
}