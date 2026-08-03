export function getBufferedSecondsAhead(
  media: Pick<HTMLVideoElement, "buffered" | "currentTime">,
): number {
  const ranges = media.buffered;
  for (let index = 0; index < ranges.length; index++) {
    const start = ranges.start(index);
    const end = ranges.end(index);
    if (media.currentTime >= start - 0.25 && media.currentTime <= end) {
      return Math.max(0, end - Math.max(media.currentTime, start));
    }
    // MSE timestamps can start far above currentTime before autoplay begins.
    if (media.currentTime < start) return Math.max(0, end - start);
  }
  return 0;
}
