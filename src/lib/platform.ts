import type { FileEntry, GameManifest } from '@/types';

/**
 * Platform detection and manifest selection.
 *
 * A published build is per-platform: a Mac cannot run a Windows binary, so the
 * launcher must pick its own slice of the manifest rather than the whole thing.
 * The decision is made once, at the boundary where a manifest enters the app, so
 * nothing downstream re-implements it.
 */

export const KNOWN_PLATFORMS = ['windows', 'macos', 'linux'] as const;
export type Platform = (typeof KNOWN_PLATFORMS)[number];

export function isPlatform(value: unknown): value is Platform {
  return typeof value === 'string' && (KNOWN_PLATFORMS as readonly string[]).includes(value);
}

/**
 * The platform this build of the launcher is running on.
 *
 * The Rust side is authoritative: the webview's userAgent is unreliable inside
 * Tauri, where it reflects the host webview rather than the OS in some builds.
 * Anything else is a guess, and a wrong guess means downloading a build that
 * cannot run - so an undetermined platform is reported as null rather than
 * defaulted, and callers refuse to install instead of trying.
 */
export function detectPlatform(): Platform | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent || '';
  if (/mac/i.test(ua)) return 'macos';
  if (/win/i.test(ua)) return 'windows';
  if (/linux|x11/i.test(ua)) return 'linux';
  return null;
}

/** A manifest narrowed to the platform the user can actually run. */
export interface PlatformBuild {
  executable: string;
  files: FileEntry[];
  baseUrl: string;
  sizeBytes: number;
}

function ensureSlash(url: string): string {
  if (!url) return '';
  return url.endsWith('/') ? url : `${url}/`;
}

function sumSizes(files: FileEntry[]): number {
  return files.reduce((sum, f) => sum + (f.size ?? 0), 0);
}

/**
 * Pick this platform's build out of a manifest.
 *
 * Multi-platform manifests carry a `platforms` map. Single-platform manifests
 * published before this layout omit it and keep the top-level executable/files;
 * those stay valid for whichever platform the publisher declared, so the
 * fallback checks that list rather than assuming the build runs everywhere.
 *
 * Returns null when the manifest has no build for this platform. The caller shows
 * the game greyed out rather than offering an install that cannot work.
 */
export function selectPlatformBuild(
  manifest: GameManifest,
  platform: Platform | null,
  supported: string[] | undefined
): PlatformBuild | null {
  const platforms = manifest.platforms;

  if (platforms && Object.keys(platforms).length > 0) {
    if (!platform) return null;
    const build = platforms[platform];
    if (!build) return null;
    return {
      executable: build.executable,
      files: build.files ?? [],
      baseUrl: ensureSlash(build.base_url ?? manifest.base_url ?? ''),
      sizeBytes: build.size_bytes ?? sumSizes(build.files ?? []),
    };
  }

  // Flat manifest. Trust the publisher's declared platform list; assuming it runs
  // would hand a Mac a Windows build.
  if (platform && supported && supported.length > 0 && !supported.includes(platform)) {
    return null;
  }
  if (!manifest.files) return null;

  return {
    executable: manifest.executable,
    files: manifest.files,
    baseUrl: ensureSlash(manifest.base_url ?? ''),
    sizeBytes: manifest.size_bytes ?? sumSizes(manifest.files),
  };
}
