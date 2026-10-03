/**
 * Show an image, falling back to text when it cannot be displayed.
 *
 * A real preview, because the only question when picking an icon is whether it is
 * the right one, and a URL box cannot answer that. The fallback matters too: the
 * URL is typed by an operator and may well be broken, and a torn-image icon
 * reads as a page that is still loading.
 */

import { useState } from 'react';

export function ImagePreview({
  url,
  alt,
  className = '',
}: {
  url: string;
  alt: string;
  className?: string;
}) {
  // The failure is recorded against the URL that failed rather than as a bare
  // boolean, and `failed` is derived from comparing the two. That preserves the
  // reset-when-the-URL-changes behaviour without an effect: editing a broken URL
  // into a working one changes `url`, the two stop matching, and the preview
  // clears on this render - where an effect resetting a plain boolean needed a
  // second render to catch up, during which the stale "cannot load" was painted.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc !== null && failedSrc === url;

  if (!url) {
    return <span className="text-[11px] text-ink-subtle">no artwork</span>;
  }

  if (failed) {
    return <span className="text-[11px] text-ink-subtle">cannot load</span>;
  }

  return (
    <img
      src={url}
      alt={alt}
      onError={() => setFailedSrc(url)}
      className={className}
      // A broken URL must not be able to break the page as well.
      referrerPolicy="no-referrer"
    />
  );
}
