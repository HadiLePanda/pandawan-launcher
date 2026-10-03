/**
 * The platform hue, defined once.
 *
 * A platform chip carries its hue, via `platformTone` for a Badge or
 * `platformHue`/`platformDot` for a plain chip and swatch. Keeping the maps here
 * is what stops the same platform wearing two colours on one screen.
 *
 * Its own module rather than a component file: a module that exports both
 * components and plain functions stops fast refresh working (the same reason `cx`
 * lives alone), and this is not a component.
 */

const PLATFORM_HUE: Record<string, string> = {
  windows: 'text-win',
  macos: 'text-mac',
  linux: 'text-linux',
};

/**
 * The same hue as a background, for the swatch beside a platform's version.
 *
 * Written out rather than composed from the id: Tailwind scans source text for
 * literal class names, so `bg-${platform}` would emit no rule at all and the
 * swatch would silently render invisible.
 */
const PLATFORM_DOT: Record<string, string> = {
  windows: 'bg-win',
  macos: 'bg-mac',
  linux: 'bg-linux',
};

/** The text hue for a platform, falling back to neutral for an id this build does not know. */
export function platformHue(platform: string): string {
  return PLATFORM_HUE[platform] ?? 'text-ink-muted';
}

/** The swatch background for a platform. */
export function platformDot(platform: string): string {
  return PLATFORM_DOT[platform] ?? 'bg-ink-faint';
}

/**
 * The `Badge` tone for a platform. The tone names are the platform ids themselves,
 * so adding a platform means adding its token here and in the palette, not a new
 * mapping in a component.
 */
export function platformTone(platform: string): string {
  return platform in PLATFORM_HUE ? platform : 'neutral';
}
