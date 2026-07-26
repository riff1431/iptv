export type IptvPlaybackErrorData = {
  details: string;
  type: string;
  response?: { code?: number };
};

export function getIptvPlaybackErrorMessage(data: IptvPlaybackErrorData): string {
  if (
    data.details === "manifestLoadError" ||
    data.details === "manifestLoadTimeOut" ||
    data.details === "manifestParsingError"
  ) {
    return data.response?.code === 429
      ? "Xtream connection limit reached. Stop playback on the other device or wait for the provider to release the existing session, then retry."
      : "Cannot load stream playlist — the channel may be offline or geo-blocked. Try again or pick another channel.";
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
