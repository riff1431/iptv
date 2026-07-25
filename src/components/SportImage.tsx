import { useState, useEffect, type ImgHTMLAttributes } from "react";
import { Tv } from "lucide-react";
import { sportImage } from "@/lib/sport-image";
import { ThumbFallback } from "@/components/ThumbFallback";

/**
 * Module-level cache of image URLs that have finished decoding in this tab.
 * Because the sport images are bundled ES module imports, the browser HTTP
 * cache already dedupes network requests — but the React component still
 * ran its "not yet decoded" skeleton every mount. This set lets us start
 * `loaded=true` when the same URL has already been decoded, skipping the
 * shimmer/fade on re-renders and cross-page navigation within the SPA.
 */
const decodedUrls = new Set<string>();

/** In-flight `HTMLImageElement`s keeping decoded bitmaps warm in memory. */
const warmed = new Map<string, HTMLImageElement>();

/**
 * Warm the browser cache for a set of sport-image URLs. Safe to call
 * repeatedly — idempotent per URL. Called once at module load for all
 * known sport images and on-demand for anything the app maps to later.
 */
export function preloadSportImages(urls: readonly string[]): void {
  if (typeof window === "undefined") return;
  for (const url of urls) {
    if (warmed.has(url)) continue;
    const img = new Image();
    img.decoding = "async";
    img.loading = "eager";
    img.src = url;
    img.onload = () => decodedUrls.add(url);
    warmed.set(url, img);
  }
}

// Preload every sport image the mapper can return, once per session.
if (typeof window !== "undefined") {
  preloadSportImages([
    sportImage("nba"),
    sportImage("soccer"),
    sportImage("ufc"),
    sportImage("nhl"),
    sportImage(""), // default
  ]);
}

type SportImageProps = {
  sport: string;
  /** Extra classes for the <img> (e.g. hover scale). */
  imgClassName?: string;
  /** Extra classes for the absolute wrapper. */
  wrapperClassName?: string;
  width?: number;
  height?: number;
  eager?: boolean;
} & Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height" | "loading" | "className">;

/**
 * Sport hero image. Fills its parent (which must own the aspect ratio,
 * e.g. `aspect-video`) with a `object-cover object-center` crop so every
 * image renders identically at every breakpoint. Includes a skeleton
 * shimmer placeholder + smooth fade-in on decode to avoid pop-in.
 *
 * Consistency contract:
 * - Parent element owns aspect ratio (arena + homepage both use `aspect-video`).
 * - Image always uses `object-cover object-center` — cinematic bottom-heavy
 *   sport photography crops cleanly at any width.
 * - Repeat mounts of an already-decoded URL skip the skeleton via the
 *   module-level `decodedUrls` cache.
 */
export function SportImage({
  sport,
  imgClassName = "",
  wrapperClassName = "",
  width = 1024,
  height = 576,
  eager = false,
  alt = "",
  ...rest
}: SportImageProps) {
  const src = sportImage(sport);
  const hasSport = Boolean(sport && sport.trim());
  const [loaded, setLoaded] = useState<boolean>(() => decodedUrls.has(src));
  const [failed, setFailed] = useState<boolean>(false);

  // If `sport` changes to a different image, re-evaluate cache hit.
  useEffect(() => {
    setLoaded(decodedUrls.has(src));
    setFailed(false);
  }, [src]);

  const onDecoded = () => {
    decodedUrls.add(src);
    setLoaded(true);
  };

  const showFallback = !hasSport || failed;

  return (
    <div className={`absolute inset-0 overflow-hidden ${wrapperClassName}`}>
      {/* Skeleton — visible until the image decodes.
          Respects prefers-reduced-motion: no pulse, instant swap. */}
      {!showFallback && (
        <div
          aria-hidden
          className={`absolute inset-0 bg-gradient-to-br from-arena-panel-2 via-arena-panel to-black transition-opacity duration-500 ease-out motion-reduce:transition-none ${
            loaded ? "opacity-0" : "opacity-100 animate-pulse motion-reduce:animate-none"
          }`}
        />
      )}
      {showFallback ? (
        <ThumbFallback icon={Tv} label={typeof alt === "string" && alt ? alt : undefined} size="md" />
      ) : (
        <img
          {...rest}
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading={eager ? "eager" : "lazy"}
          decoding={eager ? "sync" : "async"}
          fetchPriority={eager ? "high" : "low"}
          onLoad={onDecoded}
          onError={() => {
            setFailed(true);
            setLoaded(true);
          }}
          className={`absolute inset-0 h-full w-full object-cover object-center transition-[opacity,filter,transform] duration-700 ease-out motion-reduce:transition-none ${
            loaded ? "opacity-70 blur-0 scale-100 group-hover:opacity-90" : "opacity-0 blur-md scale-[1.04]"
          } ${imgClassName}`}
        />
      )}

    </div>
  );
}
