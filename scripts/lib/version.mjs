import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// package.json is the source of truth; the rest are written from it.
export const VERSION_FILES = [
  'package.json',
  'src-tauri/tauri.conf.json',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
];

const LOCK_PACKAGE = 'pandawan-launcher';

/** Our own crate's block in the lock. Hundreds of dependencies carry a version too. */
function cargoLockPackageSection(text) {
  const name = new RegExp(`^name\\s*=\\s*"${LOCK_PACKAGE}"$`, 'm');
  return text.split(/\n(?=\[\[package\]\])/).find((block) => name.test(block)) ?? null;
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
const JSON_VERSION = /"version"\s*:\s*"([^"]*)"/;

/** The [package] section only: a dependency line can begin with `version =` too. */
function cargoPackageSection(text) {
  const start = text.indexOf('[package]');
  if (start === -1) return null;
  const next = text.indexOf('\n[', start + 1);
  return next === -1 ? text.slice(start) : text.slice(start, next);
}

export function readVersion(file, text) {
  if (file.endsWith('.lock')) {
    const match = cargoLockPackageSection(text)?.match(/^version\s*=\s*"([^"]*)"/m);
    return match ? match[1] : null;
  }
  if (file.endsWith('.toml')) {
    const match = cargoPackageSection(text)?.match(/^version\s*=\s*"([^"]*)"/m);
    return match ? match[1] : null;
  }
  const match = text.match(JSON_VERSION);
  return match ? match[1] : null;
}

export function readVersions(root = repoRoot) {
  const versions = {};
  for (const file of VERSION_FILES) {
    try {
      versions[file] = readVersion(file, readFileSync(path.join(root, file), 'utf8'));
    } catch {
      versions[file] = null;
    }
  }
  return versions;
}

export function checkVersions(root = repoRoot) {
  const versions = readVersions(root);
  const distinct = new Set(Object.values(versions));
  return { ok: distinct.size === 1 && !distinct.has(null), versions };
}

/**
 * The next version for a bump level, patch by default.
 *
 * The ONE bump rule. release.mjs writes the version files with it and the
 * dashboard previews the same result, so the number on the button cannot drift
 * from the number the release writes.
 */
export function bumpVersion(version, level = 'patch') {
  const [major, minor, patch] = String(version ?? '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export function writeVersion(next, root = repoRoot) {
  if (!SEMVER.test(next)) throw new Error(`not a semver version: ${next}`);
  const changed = [];
  for (const file of VERSION_FILES) {
    const full = path.join(root, file);
    const text = readFileSync(full, 'utf8');
    const current = readVersion(file, text);
    if (current === null) throw new Error(`${file} has no version field to replace`);
    if (current === next) continue;

    let updated;
    if (file.endsWith('.lock')) {
      const section = cargoLockPackageSection(text);
      if (!section) throw new Error(`${file} has no ${LOCK_PACKAGE} package block`);
      updated = text.replace(
        section,
        section.replace(/^(version\s*=\s*")([^"]*)(")/m, `$1${next}$3`)
      );
    } else if (file.endsWith('.toml')) {
      const section = cargoPackageSection(text);
      updated = text.replace(
        section,
        section.replace(/^(version\s*=\s*")([^"]*)(")/m, `$1${next}$3`)
      );
    } else {
      // The regex finds the first `version` field; for both JSON files that is the
      // top-level one, and this proves it rather than assuming it.
      const parsed = JSON.parse(text);
      if (parsed?.version !== current)
        throw new Error(`${file}: first version field is not top-level`);
      updated = text.replace(JSON_VERSION, `"version": "${next}"`);
    }
    writeFileSync(full, updated);
    changed.push({ file, from: current, to: next });
  }
  return { changed };
}
