import { useEffect, useState } from "react";
import { Tv } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Renders a channel logo with a graceful fallback icon when the URL is
 * missing or the image fails to load.
 */
export function ChannelLogo({
  src,
  alt = "",
  size = 20,
  className,
}: {
  src: string | null | undefined;
  alt?: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  // Reset error state when the source changes so a new URL gets a fresh attempt.
  useEffect(() => {
    setFailed(false);
  }, [src]);

  const wrapperClass = cn(
    "flex items-center justify-center rounded-sm bg-black/60 p-0.5 ring-1 ring-white/10",
    className,
  );
  const style = { width: size, height: size } as const;

  if (!src || failed) {
    return (
      <span aria-hidden="true" className={wrapperClass} style={style}>
        <Tv className="h-3 w-3 text-white/70" />
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      fetchPriority="low"
      width={size}
      height={size}
      className={cn(wrapperClass, "object-contain")}
      style={style}
      onError={() => setFailed(true)}
    />
  );
}
