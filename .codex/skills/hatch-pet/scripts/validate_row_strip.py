#!/usr/bin/env python3
"""Validate one generated hatch-pet row strip before it is accepted."""

from __future__ import annotations

import argparse
import json
import math
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


def color_distance(left: tuple[int, int, int], right: tuple[int, int, int]) -> float:
    return math.sqrt(sum((left[index] - right[index]) ** 2 for index in range(3)))


def remove_chroma_background(
    image: Image.Image, chroma_key: tuple[int, int, int], threshold: float
) -> Image.Image:
    rgba = image.convert("RGBA")
    data = bytearray(rgba.tobytes())
    for index in range(0, len(data), 4):
        if color_distance(tuple(data[index : index + 3]), chroma_key) <= threshold:
            data[index : index + 4] = b"\x00\x00\x00\x00"
    return Image.frombytes("RGBA", rgba.size, bytes(data))


def connected_components(image: Image.Image, alpha_threshold: int = 16) -> list[dict[str, object]]:
    alpha = image.getchannel("A")
    width, height = alpha.size
    data = alpha.tobytes()
    visited = bytearray(width * height)
    components: list[dict[str, object]] = []

    for start, value in enumerate(data):
        if value <= alpha_threshold or visited[start]:
            continue
        visited[start] = 1
        stack = [start]
        pixels: list[int] = []
        min_x = max_x = start % width
        min_y = max_y = start // width

        while stack:
            current = stack.pop()
            pixels.append(current)
            x, y = current % width, current // width
            min_x, max_x = min(min_x, x), max(max_x, x)
            min_y, max_y = min(min_y, y), max(max_y, y)
            for neighbor in (
                current - 1 if x else None,
                current + 1 if x + 1 < width else None,
                current - width if y else None,
                current + width if y + 1 < height else None,
            ):
                if neighbor is not None and not visited[neighbor] and data[neighbor] > alpha_threshold:
                    visited[neighbor] = 1
                    stack.append(neighbor)

        components.append(
            {
                "area": len(pixels),
                "bbox": (min_x, min_y, max_x + 1, max_y + 1),
                "center_x": (min_x + max_x + 1) / 2,
            }
        )
    return components


def parse_chroma_key(run_dir: Path) -> tuple[int, int, int]:
    request_path = run_dir / "pet_request.json"
    try:
        request = json.loads(request_path.read_text(encoding="utf-8"))
        raw = request["chroma_key"]["rgb"]
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise SystemExit(f"could not load chroma key from {request_path}: {exc}") from exc
    if not isinstance(raw, list) or len(raw) != 3 or not all(isinstance(value, int) for value in raw):
        raise SystemExit(f"invalid chroma key in {request_path}")
    if not all(0 <= value <= 255 for value in raw):
        raise SystemExit(f"chroma key values must be 0-255 in {request_path}")
    return tuple(raw)


def validate_row_strip(
    strip_path: Path,
    row_id: str,
    chroma_key: tuple[int, int, int],
    key_threshold: float = 96.0,
    min_noise_pixels: int = 12,
    edge_margin: int = 2,
) -> dict[str, object]:
    expected_frames = ROW_FRAME_COUNTS[row_id]
    errors: list[str] = []
    try:
        with Image.open(strip_path) as opened:
            source = opened.convert("RGBA")
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "row_id": row_id,
            "strip": str(strip_path),
            "errors": [f"could not open row strip: {exc}"],
            "components": [],
        }

    strip = remove_chroma_background(source, chroma_key, key_threshold)
    components = connected_components(strip)
    significant = [component for component in components if component["area"] >= min_noise_pixels]
    significant.sort(key=lambda component: float(component["center_x"]))

    if len(significant) != expected_frames:
        errors.append(
            f"expected {expected_frames} disconnected sprite silhouettes, found {len(significant)}"
        )

    for index, component in enumerate(significant):
        left, top, right, bottom = component["bbox"]
        if left <= edge_margin or top <= edge_margin or right >= strip.width - edge_margin or bottom >= strip.height - edge_margin:
            errors.append(f"component {index:02d} touches the strip edge; regenerate with safe padding")

    for previous, current in zip(significant, significant[1:]):
        previous_right = previous["bbox"][2]
        current_left = current["bbox"][0]
        if current_left - previous_right <= edge_margin:
            errors.append("adjacent sprite silhouettes have no clean chroma-key gap")

    return {
        "ok": not errors,
        "row_id": row_id,
        "strip": str(strip_path),
        "expected_frames": expected_frames,
        "image_size": [strip.width, strip.height],
        "errors": errors,
        "components": [
            {
                "area": component["area"],
                "bbox": list(component["bbox"]),
                "center_x": component["center_x"],
            }
            for component in significant
        ],
    }


def validate_row_from_run(
    run_dir: Path, row_id: str, key_threshold: float = 96.0
) -> dict[str, object]:
    if row_id not in ROW_FRAME_COUNTS:
        raise ValueError(f"unknown row id: {row_id}")
    resolved_run = run_dir.resolve()
    strip_path = (resolved_run / "decoded" / f"{row_id}.png").resolve()
    try:
        strip_path.relative_to(resolved_run)
    except ValueError as exc:
        raise ValueError("row strip must resolve under the run directory") from exc
    if not strip_path.is_file():
        return {
            "ok": False,
            "row_id": row_id,
            "strip": str(strip_path),
            "errors": ["decoded row strip is missing"],
            "components": [],
        }
    return validate_row_strip(strip_path, row_id, parse_chroma_key(resolved_run), key_threshold)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--row-id", required=True, choices=sorted(ROW_FRAME_COUNTS))
    parser.add_argument("--json-out")
    parser.add_argument("--key-threshold", type=float, default=96.0)
    args = parser.parse_args()

    run_dir = Path(args.run_dir).expanduser().resolve()
    result = validate_row_from_run(run_dir, args.row_id, args.key_threshold)
    json_out = (
        Path(args.json_out).expanduser().resolve()
        if args.json_out
        else run_dir / "qa" / "row-preflight" / f"{args.row_id}.json"
    )
    try:
        json_out.relative_to(run_dir)
    except ValueError as exc:
        raise SystemExit("--json-out must resolve under --run-dir") from exc
    json_out.parent.mkdir(parents=True, exist_ok=True)
    json_out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in result.items() if key != "components"}, indent=2))
    raise SystemExit(0 if result["ok"] else 1)


if __name__ == "__main__":
    main()
