#!/usr/bin/env python3
"""Generate a Pandawan Launcher game manifest from a built game folder.

Usage:
    python scripts/generate-manifest.py \\
        --game-id pandawan-rising \\
        --name "Pandawan Rising" \\
        --version 1.0.0 \\
        --build-number 1 \\
        --executable "PandawanRising.exe" \\
        --cdn-origin "https://pub-789d1bb0f3da4a99ae1024d53ea305d3.r2.dev" \\
        --channel "stable" \\
        --input-dir "./Builds/StandaloneWindows64-v1.0.0" \\
        --output "manifest.json"

Optional:
    --description "A game about..."
    --icon-url "https://.../icon.png"
    --banner-url "https://.../banner.png"
    --launch-args "-launcher -fullscreen"
    --patch-notes patch-notes.json
"""

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from datetime import datetime, timezone


def compute_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


# Path fragments excluded from every build. Unity emits a
# "<Product>_BackUpThisFolder_ButDontShipItWithYourGame" folder that must never
# be shipped; leaving it in would download dead weight on every install. The build
# report is Unity's own diagnostics, written beside the build root, and is not part
# of the game - shipping it puts Unity's internals in every player's install. The
# zip beside a Mac export duplicates the app bundle it was made from.
#
# Matching is a substring test, so a pattern is a fragment ("build-report-"), never
# a glob: "*.zip" matches nothing and silently lets the zip through.
DEFAULT_EXCLUDES = (
    "_BackUpThisFolder_ButDontShipItWithYourGame",
    "build-report-",
    ".zip",
)


def collect_files(input_dir: Path, excludes: tuple[str, ...] = DEFAULT_EXCLUDES) -> list[tuple[Path, Path]]:
    """Return list of (relative_path, absolute_path) for all files.

    Any path containing an excluded fragment is skipped. Matching is done on
    the posix form of the relative path so the same excludes work on Windows.
    """
    files = []
    for root, dirnames, filenames in os.walk(input_dir):
        # Prune excluded directories in place so os.walk never descends into
        # them; checking filenames too covers excludes matched mid-path.
        dirnames[:] = [d for d in dirnames if not any(x in d for x in excludes)]
        for name in filenames:
            abs_path = Path(root) / name
            rel_path = abs_path.relative_to(input_dir)
            posix = rel_path.as_posix()
            if any(x in posix for x in excludes):
                continue
            files.append((rel_path, abs_path))
    files.sort(key=lambda x: str(x[0]).replace("\\", "/"))
    return files


# Channels the launcher understands, ordered most to least stable. Kept in sync
# with KNOWN_CHANNELS in src-tauri/src/types.rs and KNOWN_CHANNELS in
# src/lib/catalog-service.ts.
KNOWN_CHANNELS = ("stable", "beta", "alpha")
DEFAULT_CHANNEL = "stable"

# Platform identifiers, kept in sync with Platform in src-tauri/src/types.rs and
# PLATFORM_LABELS in src/lib/game-filters.ts.
KNOWN_PLATFORMS = ("windows", "macos", "linux")


def channel_from_version(version: str) -> str:
    """Derive the release channel from a semver prerelease tag.

    Deriving it removes a parameter that could contradict the version string:
    the publisher cannot accidentally ship 0.4.0-alpha.1 labelled `stable`.
    An unrecognised prerelease is an error rather than a silent `stable`,
    because a typo like "0.4.0-alfa.1" would otherwise mislabel a test build
    as a stable release for every player.
    """
    if "-" not in version:
        return DEFAULT_CHANNEL

    prerelease = version.split("-", 1)[1].lower()
    if "." in prerelease:
        prerelease = prerelease.split(".", 1)[0]

    if prerelease in KNOWN_CHANNELS:
        return prerelease
    if prerelease == "rc":
        return "beta"
    raise ValueError(
        f"Cannot derive a channel from version {version!r}: unknown prerelease "
        f"{prerelease!r}. Use one of {', '.join(KNOWN_CHANNELS)} or 'rc', or drop "
        "the prerelease for a stable build."
    )


def load_patch_notes(path: Path | None) -> list | None:
    if not path:
        return None
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and "notes" in data:
        return data["notes"]
    raise ValueError(f"Invalid patch notes file: {path}")


def parse_platform_specs(specs: list[str] | None) -> list[tuple[str, Path]]:
    """Parse repeated --platform "windows=./dir" arguments.

    Rejects unknown platforms and duplicate entries rather than silently dropping
    one: a typo like "mac=..." would otherwise ship a build the client will never
    look for, and a duplicate would let one overwrite the other.
    """
    if not specs:
        return []

    out: list[tuple[str, Path]] = []
    seen: set[str] = set()

    for spec in specs:
        if "=" not in spec:
            raise ValueError(
                f"Invalid --platform {spec!r}. Expected <platform>=<dir>, e.g. macos=./Builds/mac"
            )
        name, raw_dir = spec.split("=", 1)
        name = name.strip().lower()

        if name not in KNOWN_PLATFORMS:
            raise ValueError(
                f"Unknown platform {name!r}. Use one of {', '.join(KNOWN_PLATFORMS)}."
            )
        if name in seen:
            raise ValueError(f"Platform {name!r} given more than once.")

        path = Path(raw_dir.strip()).resolve()
        if not path.exists():
            raise FileNotFoundError(f"Platform {name!r} directory not found: {path}")

        seen.add(name)
        out.append((name, path))

    return out


def platform_executable(platform: str, build_dir: Path, fallback: str) -> str:
    """The main binary the launcher should start for this platform's build.

    Windows is just the .exe. A macOS build is a .app bundle, and the process to
    start is the binary inside Contents/MacOS rather than the bundle itself, so
    the path has to be derived from the build. Both the bundle name and the inner
    binary name are read from disk: Unity lets either be set in Player Settings,
    so hardcoding either would break the moment a build is renamed.

    Falls back to the manifest's top-level executable if the bundle is not found,
    which keeps a mis-shaped macOS build from producing a manifest that points at
    nothing.
    """
    if platform != "macos":
        return fallback

    bundles = [p for p in build_dir.iterdir() if p.suffix == ".app"]
    if len(bundles) != 1:
        return fallback

    plist = bundles[0] / "Contents" / "Info.plist"
    exe_name = fallback
    if plist.exists():
        # Minimal scan rather than a plist parser: this file only ever needs one
        # string, and the build machine has no plistlib guarantee across versions.
        try:
            text = plist.read_text(encoding="utf-8", errors="replace")
            marker = "<key>CFBundleExecutable</key>"
            idx = text.find(marker)
            if idx != -1:
                rest = text[idx + len(marker):]
                start = rest.find("<string>")
                end = rest.find("</string>")
                if start != -1 and end > start:
                    exe_name = rest[start + len("<string>"):end].strip()
        except OSError:
            pass

    return f"{bundles[0].name}/Contents/MacOS/{exe_name}"


def build_file_entries(input_dir: Path, excludes: tuple[str, ...]) -> list[dict]:
    """Hash and size every publishable file under input_dir."""
    entries = []
    for rel_path, abs_path in collect_files(input_dir, excludes):
        posix_path = rel_path.as_posix()
        entries.append({
            "path": posix_path,
            "hash": compute_sha256(abs_path),
            "size": abs_path.stat().st_size,
            "url": posix_path,
            "compress": None,
        })
    return entries


def generate_manifest(args) -> dict:
    # Each --platform carries its own directory, so --input-dir is only needed
    # for a single-platform (flat) publish.
    input_dir = Path(args.input_dir).resolve() if args.input_dir else None
    if input_dir is not None and not input_dir.exists():
        raise FileNotFoundError(f"Input directory not found: {input_dir}")

    # The channel is derived from the version so the two can never disagree. An
    # explicit --channel is accepted only when it matches, which turns a
    # mismatch into an error instead of a mislabelled build.
    derived = channel_from_version(args.version)
    if args.channel and args.channel != derived:
        raise ValueError(
            f"Channel {args.channel!r} does not match version {args.version!r}, "
            f"which implies {derived!r}. Omit --channel to use the derived value."
        )
    channel = derived

    # Build bytes live under a version-stamped directory. That is what makes the
    # IMMUTABLE cache header honest: the bytes at a given URL never change, so a
    # client that cached them can never serve a stale file after an update.
    # The manifest stays one level up at .../{channel}/manifest.json because it is
    # mutable and is the signal that a new build exists.
    #
    # Each platform gets its own subdirectory below the version. Windows and macOS
    # builds of the same version are different files with the same names in places
    # (both have a Data folder, both ship a main binary), so a shared directory
    # would let one overwrite the other.
    version_dir = args.version
    base_url = f"{args.cdn_origin.rstrip('/')}/games/{args.game_id}/{channel}/{version_dir}"

    # --platform is repeatable: "windows=./Builds/win,macos=./Builds/mac". A single
    # --input-dir with no --platform keeps the original flat shape, so manifests
    # published before this existed still load.
    platform_dirs = parse_platform_specs(args.platform)
    if not platform_dirs:
        if input_dir is None:
            raise FileNotFoundError("--input-dir is required when no --platform is given.")
        platform_dirs = [(None, input_dir)]

    excludes = tuple(args.exclude or ()) + DEFAULT_EXCLUDES
    platforms: dict[str, dict] = {}
    single_entries = None

    for platform, dir_path in platform_dirs:
        entries = build_file_entries(dir_path, excludes)
        entry_base = base_url if platform is None else f"{base_url}/{platform}"

        if platform is None:
            single_entries = entries
            flat_base = entry_base
        else:
            platforms[platform] = {
                "executable": platform_executable(platform, dir_path, args.executable),
                "base_url": f"{entry_base}/",
                "size_bytes": sum(e["size"] for e in entries),
                "files": entries,
            }

    total_size = sum(p["size_bytes"] for p in platforms.values())
    if single_entries is not None:
        total_size = sum(e["size"] for e in single_entries)

    patch_notes = load_patch_notes(args.patch_notes)

    manifest = {
        "game_id": args.game_id,
        "name": args.name,
        "version": args.version,
        "build_number": args.build_number,
        "channel": channel,
        "executable": args.executable,
        # Absolute base the client joins each file's relative "url" onto. Carried
        # in the manifest because the version-stamped directory is not derivable
        # from the manifest's own location (the manifest sits one level up).
        "base_url": f"{flat_base}/" if single_entries is not None else None,
        "description": args.description or None,
        "icon_url": args.icon_url or None,
        "banner_url": args.banner_url or None,
        "release_date": args.release_date or datetime.now(timezone.utc).isoformat(),
        "size_bytes": total_size,
        "patch_notes": patch_notes,
        "files": single_entries,
        # Per-platform builds. Absent on single-platform manifests, which keep the
        # top-level executable/files shape so older clients still load them.
        "platforms": platforms or None,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    return manifest


def main():
    parser = argparse.ArgumentParser(
        description="Generate a Pandawan Launcher game manifest from a build folder."
    )
    parser.add_argument("--game-id", required=True, help="Unique game identifier")
    parser.add_argument("--name", required=True, help="Display name of the game")
    parser.add_argument("--version", required=True, help="Game version (e.g. 1.0.0)")
    parser.add_argument("--build-number", type=int, required=True, help="Build number")
    parser.add_argument("--executable", required=True, help="Main executable filename")
    parser.add_argument("--cdn-origin", required=True, help="CDN origin, e.g. https://pub-789d1bb0f3da4a99ae1024d53ea305d3.r2.dev")
    parser.add_argument(
        "--channel",
        default=None,
        help=(
            "Release channel. Derived from the version prerelease when omitted "
            "(0.4.0-alpha.3 -> alpha, plain 1.0.0 -> stable); passing a value "
            "that contradicts the version is an error."
        ),
    )
    parser.add_argument("--input-dir", help="Folder containing the built game (single-platform publish)")
    parser.add_argument(
        "--platform",
        action="append",
        default=None,
        metavar="NAME=DIR",
        help=(
            "Per-platform build folder, repeatable: windows=./Builds/win macos=./Builds/mac. "
            "Each platform is published under its own subdirectory of the version. "
            "Omit for a single-platform build, which keeps the flat manifest shape."
        ),
    )
    parser.add_argument("--output", default="manifest.json", help="Output manifest path")
    parser.add_argument("--description", default=None, help="Short game description")
    parser.add_argument("--icon-url", default=None, help="URL to game icon")
    parser.add_argument("--banner-url", default=None, help="URL to game banner")
    parser.add_argument("--release-date", default=None, help="ISO release date")
    parser.add_argument("--patch-notes", default=None, help="Path to a JSON patch notes file")
    parser.add_argument(
        "--exclude",
        action="append",
        default=None,
        help=(
            "Path fragment to skip, repeatable. Always excludes "
            f"{DEFAULT_EXCLUDES[0]!r} for Unity builds."
        ),
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        default=True,
        help="Pretty-print JSON output",
    )

    args = parser.parse_args()

    manifest = generate_manifest(args)

    output_path = Path(args.output)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2 if args.pretty else None, ensure_ascii=False)
        f.write("\n")

    channel = manifest["channel"]
    platforms = manifest.get("platforms") or {}

    print(f"Manifest written: {output_path}")
    print(f"Channel: {channel}")

    if platforms:
        # Per-platform. Report each one so a typo in a build folder is visible
        # here rather than as a 404 on a player's machine.
        print(f"Platforms: {len(platforms)}")
        for name, data in platforms.items():
            size = sum(entry["size"] for entry in data["files"])
            print(
                f"  {name}: {len(data['files'])} files, "
                f"{size / (1024 * 1024):.2f} MB, exe={data['executable']}"
            )
            print(f"    {data['base_url']}")
        total = sum(
            sum(e["size"] for e in data["files"]) for data in platforms.values()
        )
        print(f"Total size: {total / (1024 * 1024):.2f} MB")
    else:
        entries = manifest["files"] or []
        total_size = sum(entry["size"] for entry in entries)
        print(f"Base URL: {manifest['base_url']}")
        print(f"Files: {len(entries)}")
        print(f"Total size: {total_size / (1024 * 1024):.2f} MB")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
