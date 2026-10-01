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
# be shipped; leaving it in would download dead weight on every install.
DEFAULT_EXCLUDES = ("_BackUpThisFolder_ButDontShipItWithYourGame",)


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


def generate_manifest(args) -> dict:
    input_dir = Path(args.input_dir).resolve()
    if not input_dir.exists():
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

    base_url = f"{args.cdn_origin.rstrip('/')}/games/{args.game_id}/{channel}"

    files = collect_files(input_dir, tuple(args.exclude or ()) + DEFAULT_EXCLUDES)
    entries = []
    for rel_path, abs_path in files:
        posix_path = rel_path.as_posix()
        entries.append({
            "path": posix_path,
            "hash": compute_sha256(abs_path),
            "size": abs_path.stat().st_size,
            "url": posix_path,
            "compress": None,
        })

    total_size = sum(entry["size"] for entry in entries)
    patch_notes = load_patch_notes(args.patch_notes)

    manifest = {
        "game_id": args.game_id,
        "name": args.name,
        "version": args.version,
        "build_number": args.build_number,
        "channel": channel,
        "executable": args.executable,
        "description": args.description or None,
        "icon_url": args.icon_url or None,
        "banner_url": args.banner_url or None,
        "release_date": args.release_date or datetime.now(timezone.utc).isoformat(),
        "launch_args": args.launch_args.split() if args.launch_args else None,
        "size_bytes": total_size,
        "patch_notes": patch_notes,
        "files": entries,
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
    parser.add_argument("--input-dir", required=True, help="Folder containing the built game")
    parser.add_argument("--output", default="manifest.json", help="Output manifest path")
    parser.add_argument("--description", default=None, help="Short game description")
    parser.add_argument("--icon-url", default=None, help="URL to game icon")
    parser.add_argument("--banner-url", default=None, help="URL to game banner")
    parser.add_argument("--release-date", default=None, help="ISO release date")
    parser.add_argument("--launch-args", default=None, help="Default launch arguments")
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

    total_size = sum(entry["size"] for entry in manifest["files"])
    channel = manifest["channel"]
    base_url = f"{args.cdn_origin.rstrip('/')}/games/{args.game_id}/{channel}"
    print(f"Manifest written: {output_path}")
    print(f"Base URL: {base_url}")
    print(f"Channel: {channel}")
    print(f"Files: {len(manifest['files'])}")
    print(f"Total size: {total_size / (1024 * 1024):.2f} MB")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
