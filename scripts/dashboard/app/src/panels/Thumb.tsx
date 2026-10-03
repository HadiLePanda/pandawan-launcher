/**
 * A thumbnail that renders whether or not the image behind it exists.
 *
 * A URL that 404s, or a relative path the dev server does not serve, renders as
 * a torn-image icon and a row that looks empty - indistinguishable from a
 * genuinely empty catalog. So a failure here is a visible placeholder tile, and
 * the row around it always renders its name and id.
 *
 * A protocol-relative or relative URL is resolved against the dashboard origin
 * rather than trusted: catalog.json holds `/placeholder-icon.svg`, which resolves
 * against the CDN in production but means nothing to the panel.
 */
import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { cx } from './cx';

export type ThumbShape = 'square' | 'wide';

export function Thumb({
  url,
  alt,
  shape = 'square',
  className,
}: {
  url: string | null | undefined;
  alt: string;
  shape?: ThumbShape;
  className?: string;
}) {
  const src = typeof url === 'string' ? url.trim() : '';
  // Reset on every src change: a previously failed URL must not keep its error
  // state when the entry is edited to a working one. The failure is stored as
  // the src it belongs to and `failed` is derived from comparing the two, so the
  // reset happens during render instead of needing an effect to set a plain
  // boolean back to false a render later - which is what left a stale error tile
  // painted in the gap.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc !== null && failedSrc === src;

  const box = cx(
    'relative flex shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-canvas',
    shape === 'square' ? 'h-10 w-10' : 'h-10 w-20',
    className
  );

  if (!src) {
    return (
      <div className={box} title={`${alt}: no artwork set`}>
        <ImageOff aria-hidden size={16} className="text-ink-subtle" />
        <span className="sr-only">{alt}: no artwork set</span>
      </div>
    );
  }

  if (failed) {
    return (
      <div className={box} title={`${alt}: ${src} could not be loaded`}>
        <ImageOff aria-hidden size={16} className="text-ember" />
        <span className="sr-only">{alt}: the image could not be loaded</span>
      </div>
    );
  }

  return (
    <div className={box}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className="h-full w-full object-cover"
        onError={() => setFailedSrc(src)}
      />
    </div>
  );
}
