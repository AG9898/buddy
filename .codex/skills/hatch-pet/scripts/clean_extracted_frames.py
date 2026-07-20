#!/usr/bin/env python3
"""Remove chroma fringe from extracted frames and normalize transparent RGB."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROW_FRAME_COUNTS = {
    "idle": 6,
    "running-right": 8,
    "running-left": 8,
    "waving": 4,
    "jumping": 5,
    "failed": 8,
    "waiting": 6,
    "running": 6,
    "review": 6,
}


def chroma_key_from_run(frames_root: Path) -> str:
    request_path = frames_root.parent / "pet_request.json"
    try:
        request = json.loads(request_path.read_text(encoding="utf-8"))
        chroma_key = request["chroma_key"]["hex"]
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise SystemExit(f"could not load chroma key from {request_path}: {exc}") from exc
    if not isinstance(chroma_key, str) or len(chroma_key) != 7 or not chroma_key.startswith("#"):
        raise SystemExit(f"invalid chroma key in {request_path}")
    return chroma_key


def helper_path() -> Path:
    codex_home = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex")).expanduser()
    helper = (codex_home / "skills" / ".system" / "imagegen" / "scripts" / "remove_chroma_key.py").resolve()
    if not helper.is_file():
        raise SystemExit(f"imagegen chroma helper not found: {helper}")
    return helper


def normalize_transparent_rgb(path: Path) -> int:
    with Image.open(path) as opened:
        image = opened.convert("RGBA")
    data = bytearray(image.tobytes())
    normalized = 0
    for index in range(0, len(data), 4):
        if data[index + 3] == 0 and any(data[index : index + 3]):
            data[index : index + 3] = b"\x00\x00\x00"
            normalized += 1
    Image.frombytes("RGBA", image.size, bytes(data)).save(path)
    return normalized


def frame_paths(frames_root: Path) -> list[Path]:
    paths: list[Path] = []
    for state, expected_count in ROW_FRAME_COUNTS.items():
        state_dir = frames_root / state
        for index in range(expected_count):
            frame = (state_dir / f"{index:02d}.png").resolve()
            try:
                frame.relative_to(frames_root)
            except ValueError as exc:
                raise SystemExit("frame path escaped frames root") from exc
            if not frame.is_file():
                raise SystemExit(f"missing extracted frame: {frame}")
            paths.append(frame)
    return paths


def clean_frame(helper: Path, frame: Path, chroma_key: str) -> int:
    with tempfile.NamedTemporaryFile(
        prefix=f".{frame.stem}-", suffix=".png", dir=frame.parent, delete=False
    ) as temporary:
        temporary_path = Path(temporary.name)
    try:
        command = [
            sys.executable,
            str(helper),
            "--input",
            str(frame),
            "--out",
            str(temporary_path),
            "--key-color",
            chroma_key,
            "--soft-matte",
            "--transparent-threshold",
            "12",
            "--opaque-threshold",
            "220",
            "--despill",
            "--edge-contract",
            "1",
            "--force",
        ]
        completed = subprocess.run(command, check=False, capture_output=True, text=True)
        if completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip() or "unknown helper failure"
            raise SystemExit(f"chroma cleanup failed for {frame}: {detail}")
        normalized = normalize_transparent_rgb(temporary_path)
        os.replace(temporary_path, frame)
        return normalized
    finally:
        temporary_path.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frames-root", required=True)
    parser.add_argument("--chroma-key", help="Override the chroma key from pet_request.json.")
    parser.add_argument("--json-out")
    args = parser.parse_args()

    frames_root = Path(args.frames_root).expanduser().resolve()
    if not frames_root.is_dir():
        raise SystemExit(f"frames root does not exist: {frames_root}")
    chroma_key = args.chroma_key or chroma_key_from_run(frames_root)
    helper = helper_path()
    frames = frame_paths(frames_root)
    normalized_pixels = sum(clean_frame(helper, frame, chroma_key) for frame in frames)
    result = {
        "ok": True,
        "frames_root": str(frames_root),
        "frames_cleaned": len(frames),
        "normalized_transparent_pixels": normalized_pixels,
        "chroma_key": chroma_key,
    }
    if args.json_out:
        json_out = Path(args.json_out).expanduser().resolve()
        try:
            json_out.relative_to(frames_root.parent)
        except ValueError as exc:
            raise SystemExit("--json-out must resolve under the hatch run directory") from exc
        json_out.parent.mkdir(parents=True, exist_ok=True)
        json_out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
