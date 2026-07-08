#!/usr/bin/env python3
"""Generate a Pandawan Launcher game manifest from a built game folder.

Usage:
    python scripts/generate-manifest.py \\
        --game-id pandawan-rising \\
        --name "Pandawan Rising" \\
        --version 1.0.0 \\
        --build-number 1 \\
        --executable "PandawanRising.exe" \\
        --cdn-origin "https://cdn.pandawancorp.com" \\
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


def collect_files(input_dir: Path) -> list[tuple[Path, Path]]:
    """Return list of (relative_path, absolute_path) for all files."""
    files = []
    for root, _, filenames in os.walk(input_dir):
        for name in filenames:
            abs_path = Path(root) / name
            rel_path = abs_path.relative_to(input_dir)
            files.append((rel_path, abs_path))
    files.sort(key=lambda x: str(x[0]).replace("\\", "/"))
    return files


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

    base_url = f"{args.cdn_origin.rstrip('/')}/games/{args.game_id}/{args.channel}"

    files = collect_files(input_dir)
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
    parser.add_argument("--cdn-origin", required=True, help="CDN origin, e.g. https://cdn.pandawancorp.com")
    parser.add_argument("--channel", default="stable", help="Release channel (default: stable)")
    parser.add_argument("--input-dir", required=True, help="Folder containing the built game")
    parser.add_argument("--output", default="manifest.json", help="Output manifest path")
    parser.add_argument("--description", default=None, help="Short game description")
    parser.add_argument("--icon-url", default=None, help="URL to game icon")
    parser.add_argument("--banner-url", default=None, help="URL to game banner")
    parser.add_argument("--release-date", default=None, help="ISO release date")
    parser.add_argument("--launch-args", default=None, help="Default launch arguments")
    parser.add_argument("--patch-notes", default=None, help="Path to a JSON patch notes file")
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
    base_url = f"{args.cdn_origin.rstrip('/')}/games/{args.game_id}/{args.channel}"
    print(f"Manifest written: {output_path}")
    print(f"Base URL: {base_url}")
    print(f"Files: {len(manifest['files'])}")
    print(f"Total size: {total_size / (1024 * 1024):.2f} MB")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
