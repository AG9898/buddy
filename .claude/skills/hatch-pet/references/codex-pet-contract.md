# Codex Pet Contract

## Sprite Atlas

- Format: PNG or WebP.
- Dimensions: `1536x1872`.
- Grid: 8 columns x 9 rows.
- Cell: `192x208`.
- Background: transparent.
- Unused cells: fully transparent.

The webview animation uses CSS background positions from the fixed row and column counts. Do not add labels, gutters, borders, grid lines, shadows outside the cell, or extra frames.

## Local Custom Pet Package (Codex)

Place files under:

```text
${CODEX_HOME:-$HOME/.codex}/pets/<pet-name>/
├── pet.json
└── spritesheet.webp
```

Manifest shape (Codex format):

```json
{
  "id": "pet-name",
  "displayName": "Pet Name",
  "description": "One short sentence.",
  "spritesheetPath": "spritesheet.webp"
}
```

## Buddy Package

buddy uses the same atlas geometry but a richer `pet.json` that drives its Svelte
state machine. Use `package_for_buddy.py` to produce buddy's format:

```text
pets/default/
├── pet.json          — full state machine (see below)
└── spritesheet.webp  — same atlas

build/
└── icon.ico          — derived from canonical base via make_icon.py
```

Buddy `pet.json` shape:

```json
{
  "id": "default",
  "name": "Display Name",
  "spritesheet": "spritesheet.webp",
  "frameWidth": 192,
  "frameHeight": 208,
  "columns": 8,
  "rows": 9,
  "states": {
    "idle": { "frames": [{"row": 0, "col": 0, "ms": 280}, ...] },
    "running": { "frames": [...] },
    "waving": { "frames": [...], "once": true, "fallback": "idle" }
  }
}
```
