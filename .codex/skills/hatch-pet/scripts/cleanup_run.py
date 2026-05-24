"""Remove disposable hatch-pet run artifacts after a successful package."""

from __future__ import annotations

import argparse
import os
import shutil
import stat
from pathlib import Path


KEEP_FILES = {
    "pet_request.json",
    "final/spritesheet.webp",
    "final/validation.json",
    "qa/contact-sheet.png",
    "qa/review.json",
    "qa/run-summary.json",
}

KEEP_DIRS = {
    "qa/previews",
}

REMOVE_PATHS = {
    "imagegen-jobs.json",
    "prompts",
    "decoded",
    "frames",
    "references/layout-guides",
    "final/spritesheet.png",
}


def resolve_inside(base: Path, relative: str) -> Path:
    base_resolved = base.resolve()
    target = (base / relative).resolve()
    try:
        target.relative_to(base_resolved)
    except ValueError as exc:
        raise SystemExit(f"refusing to touch path outside run dir: {target}") from exc
    return target


def remove_path(path: Path, dry_run: bool) -> None:
    if not path.exists():
        return
    print(f"{'would remove' if dry_run else 'removing'} {path}")
    if dry_run:
        return
    if path.is_dir():
        make_writable_tree(path)
        shutil.rmtree(path, onerror=make_writable_and_retry)
    else:
        make_writable(path)
        path.unlink()


def make_writable(path: Path) -> None:
    try:
        os.chmod(path, stat.S_IWRITE | stat.S_IREAD | stat.S_IEXEC)
    except FileNotFoundError:
        return


def make_writable_tree(path: Path) -> None:
    make_writable(path)
    for child in path.rglob("*"):
        make_writable(child)


def make_writable_and_retry(function, path, _exc_info) -> None:
    target = Path(path)
    make_writable(target)
    function(path)


def validate_kept_outputs(run_dir: Path) -> None:
    missing = [rel for rel in sorted(KEEP_FILES) if not (run_dir / rel).exists()]
    missing += [rel for rel in sorted(KEEP_DIRS) if not (run_dir / rel).is_dir()]
    if missing:
        raise SystemExit(
            "refusing cleanup because required kept artifact(s) are missing: "
            + ", ".join(missing)
        )


def remove_empty_parents(run_dir: Path, dry_run: bool) -> None:
    for rel in ("references", "final", "qa"):
        path = resolve_inside(run_dir, rel)
        if path.exists() and path.is_dir() and not any(path.iterdir()):
            print(f"{'would remove empty dir' if dry_run else 'removing empty dir'} {path}")
            if not dry_run:
                path.rmdir()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", required=True, type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    run_dir = args.run_dir.resolve()
    if not run_dir.is_dir():
        raise SystemExit(f"run dir does not exist: {run_dir}")

    validate_kept_outputs(run_dir)
    for rel in sorted(REMOVE_PATHS):
        remove_path(resolve_inside(run_dir, rel), args.dry_run)
    remove_empty_parents(run_dir, args.dry_run)

    print("cleanup complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
