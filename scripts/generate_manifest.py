#!/usr/bin/env python3
"""
Generate game manifest for Pandawan Launcher.

Usage:
    python generate_manifest.py --game-id quirheim-online --name "Quirheim Online" \\
        --version 1.0.0 --build 100 --executable "Game.exe" \\
        --input ./build --output ./manifest.json --base-url https://cdn.example.com/games/quirheim-online
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
from datetime import datetime


def compute_sha256(file_path: Path) -> str:
    """Compute SHA256 hash of a file."""
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()


def generate_manifest(
    game_id: str,
    name: str,
    version: str,
    build_number: int,
    description: str,
    executable: str,
    input_dir: Path,
    base_url: str,
    icon_url: str = None,
    banner_url: str = None,
) -> dict:
    """Generate manifest from build directory."""
    
    files = []
    
    for root, _, filenames in os.walk(input_dir):
        for filename in filenames:
            file_path = Path(root) / filename
            relative_path = file_path.relative_to(input_dir)
            
            # Skip the executable if it's handled separately
            if str(relative_path) == executable:
                continue
                
            file_hash = compute_sha256(file_path)
            file_size = file_path.stat().st_size
            
            files.append({
                "path": str(relative_path).replace("\\", "/"),
                "hash": file_hash,
                "size": file_size,
                "url": f"files/{str(relative_path).replace('\\', '/')}"
            })
    
    # Add executable
    exe_path = input_dir / executable
    if exe_path.exists():
        files.insert(0, {
            "path": executable,
            "hash": compute_sha256(exe_path),
            "size": exe_path.stat().st_size,
            "url": f"files/{executable}"
        })
    
    manifest = {
        "game_id": game_id,
        "name": name,
        "version": version,
        "build_number": build_number,
        "description": description,
        "icon_url": icon_url or f"{base_url}/icon.png",
        "banner_url": banner_url or f"{base_url}/banner.jpg",
        "executable": executable,
        "files": files,
        "launch_args": ["-launcher"]
    }
    
    return manifest


def main():
    parser = argparse.ArgumentParser(description="Generate game manifest for Pandawan Launcher")
    parser.add_argument("--game-id", required=True, help="Unique game identifier")
    parser.add_argument("--name", required=True, help="Game display name")
    parser.add_argument("--version", required=True, help="Game version (e.g., 1.0.0)")
    parser.add_argument("--build", type=int, required=True, help="Build number")
    parser.add_argument("--description", default="", help="Game description")
    parser.add_argument("--executable", required=True, help="Main executable name")
    parser.add_argument("--input", type=Path, required=True, help="Build input directory")
    parser.add_argument("--output", type=Path, required=True, help="Output manifest path")
    parser.add_argument("--base-url", required=True, help="CDN base URL")
    parser.add_argument("--icon-url", help="Icon URL (optional)")
    parser.add_argument("--banner-url", help="Banner URL (optional)")
    
    args = parser.parse_args()
    
    if not args.input.exists():
        print(f"Error: Input directory does not exist: {args.input}")
        return 1
    
    manifest = generate_manifest(
        game_id=args.game_id,
        name=args.name,
        version=args.version,
        build_number=args.build,
        description=args.description,
        executable=args.executable,
        input_dir=args.input,
        base_url=args.base_url,
        icon_url=args.icon_url,
        banner_url=args.banner_url,
    )
    
    # Ensure output directory exists
    args.output.parent.mkdir(parents=True, exist_ok=True)
    
    with open(args.output, "w") as f:
        json.dump(manifest, f, indent=2)
    
    total_size = sum(f["size"] for f in manifest["files"])
    print(f"Generated manifest: {args.output}")
    print(f"  Files: {len(manifest['files'])}")
    print(f"  Total size: {total_size / (1024*1024):.1f} MB")
    print(f"  Build: {manifest['build_number']}")
    
    return 0


if __name__ == "__main__":
    exit(main())
