#!/usr/bin/env python3
"""Convert a source PNG to a Windows .ico file for buddy's build/icon.ico."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

ICON_SIZES = [16, 32,48, 64, 128, 256]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="Source PNG (canonical base pet image)")
    parser.add_argument("--output", required=True, help="Output .ico path (e.g. build/icon.ico)")
    parser.add_argument(
        "--background",
        default="white",
        help="Background colour to composite against before saving (default: white). "
        "Use 'transparent' to skip compositing.",
    )
    args = parser.parse_args()

    src = Path(args.source).expanduser().resolve()
    out = Path(args.output).expanduser().resolve()

    img = Image.open(src).convert("RGBA")

    if args.background != "transparent":
        bg = Image.new("RGBA", img.size, args.background)
        bg.paste(img, mask=img.getchannel("A"))
        img = bg.convert("RGB")

    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, format="ICO", sizes=[(s, s) for s in ICON_SIZES])
    print(f"icon written: {out}")


if __name__ == "__main__":
    main()
