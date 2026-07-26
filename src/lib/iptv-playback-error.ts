export type IptvPlaybackErrorData = {
  details: string;
  type: string;
  response?: { code?: number };
};

export function isIptvHlsUrl(url: string): boolean {
  return (
    /\.m3u8($|\?)/i.test(url) ||
    url.includes("/api/public/iptv/playlist") ||
    /\/api\/public\/iptv\/channel\/[^/]+\/playlist(?:\?|$)/i.test(url)
  );
}

export function getIptvPlaybackErrorMessage(data: IptvPlaybackErrorData): string {
  if (data.response?.code === 458 || data.response?.code === 429) {
    return "Xtream Connection Limit Reached (1/1 active connections). Your IPTV provider line is already playing on another browser tab, device, or app. Please close the other active player and try again.";
  }
  if (
    data.details === "manifestLoadError" ||
    data.details === "manifestLoadTimeOut" ||
    data.details === "manifestParsingError"
  ) {
    return "Cannot load stream playlist — the channel may be offline or connection limit reached. Try again or pick another channel.";
  }
  if (data.details === "fragLoadError" || data.details === "fragLoadTimeOut") {
    return "Stream segments are being blocked (403). The channel may have expired, reached its connection limit, or be temporarily unavailable. Try Retry or switch channels.";
  }
  if (data.type === "networkError") {
    return "Network error — check your connection or try again.";
  }
  if (data.type === "mediaError") {
    return "Playback error — the stream data is unreadable.";
  }
  return "This stream could not be played.";
}
