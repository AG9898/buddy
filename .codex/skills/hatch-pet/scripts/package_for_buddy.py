#!/usr/bin/env python3
"""Package a completed hatch-pet run into buddy's pets/ directory format.

Writes:
  <output-dir>/spritesheet.webp  — copied from <run-dir>/final/spritesheet.webp
  <output-dir>/pet.json          — buddy's full state-machine format

Buddy's pet.json differs from the upstream Codex format: it includes
frameWidth/frameHeight/columns/rows and a full `states` map with per-frame
row/col/ms entries and optional once/fallback fields.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

ROW_SPECS = [
    # (state, row_index, frame_count, durations_ms, once, fallback)
    ("idle",          0, 6,  [280, 110, 110, 140, 140, 320], False, None),
    ("running-right", 1, 8,  [120, 120, 120, 120, 120, 120, 120, 220], False, None),
    ("running-left",  2, 8,  [120, 120, 120, 120, 120, 120, 120, 220], False, None),
    ("waving",        3, 4,  [140, 140, 140, 280], True,  "idle"),
    ("jumping",       4, 5,  [140, 140, 140, 140, 280], True,  "idle"),
    ("failed",        5, 8,  [140, 140, 140, 140, 140, 140, 140, 240], False, None),
    ("waiting",       6, 6,  [150, 150, 150, 150, 150, 260], False, None),
    ("running",       7, 6,  [120, 120, 120, 120, 120, 220], False, None),
    ("review",        8, 6,  [150, 150, 150, 150, 150, 280], False, None),
]

CELL_WIDTH  = 192
CELL_HEIGHT = 208
COLUMNS = 8
ROWS    = 9


def build_state_entry(
    row: int,
    frame_count: int,
    durations: list[int],
    once: bool,
    fallback: str | None,
) -> dict:
    frames = [
        {"row": row, "col": col, "ms": durations[col]}
        for col in range(frame_count)
    ]
    entry: dict = {"frames": frames}
    if once:
        entry["once"] = True
    if fallback:
        entry["fallback"] = fallback
    return entry


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir",    required=True, help="Completed hatch-pet run directory")
    parser.add_argument("--output-dir", required=True, help="Destination pets/<name>/ directory")
    parser.add_argument("--pet-id",     default=None,  help="Pet id (defaults to run-dir name)")
    parser.add_argument("--pet-name",   default=None,  help="Display name (defaults to pet-id title-cased)")
    args = parser.parse_args()

    run_dir = Path(args.run_dir).expanduser().resolve()
    out_dir = Path(args.output_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    pet_id = args.pet_id or run_dir.name
    display_name = args.pet_name or pet_id.replace("-", " ").title()

    src_sheet = run_dir / "final" / "spritesheet.webp"
    if not src_sheet.exists():
        raise FileNotFoundError(f"spritesheet not found: {src_sheet}")

    dst_sheet = out_dir / "spritesheet.webp"
    shutil.copy2(src_sheet, dst_sheet)
    print(f"spritesheet copied: {dst_sheet}")

    states = {}
    for state, row, frame_count, durations, once, fallback in ROW_SPECS:
        states[state] = build_state_entry(row, frame_count, durations, once, fallback)

    pet_json = {
        "id": pet_id,
        "name": display_name,
        "spritesheet": "spritesheet.webp",
        "frameWidth": CELL_WIDTH,
        "frameHeight": CELL_HEIGHT,
        "columns": COLUMNS,
        "rows": ROWS,
        "states": states,
    }

    dst_json = out_dir / "pet.json"
    dst_json.write_text(json.dumps(pet_json, indent=2) + "\n")
    print(f"pet.json written: {dst_json}")


if __name__ == "__main__":
    main()
