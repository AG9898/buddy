# DECISIONS.md — Architectural Decision Log

> **Open decisions:** Do not resolve without explicit instruction from the project owner.
>
> **To resolve an open decision:**
> 1. Move the block to the Resolved section.
> 2. Fill in the `Resolved` date and `Decision` / `Why` fields.
> 3. Update any docs affected ([ARCHITECTURE.md](ARCHITECTURE.md), [CONVENTIONS.md](CONVENTIONS.md), etc.).
> 4. Update this file in the same commit.
>
> **To add a new open decision:** copy the template below and assign the next OPEN-XX number.
> To add a resolved decision: copy the resolved template and assign the next RESOLVED-XX number.

---

## Open Decision Template

```
### OPEN-XX — <Short Decision Title>

**Question:** <What needs to be decided? State it as a precise question.>

**Context:** <Why does this matter? What are the constraints or tradeoffs involved?
What existing code or docs does this affect?>

**Options under consideration:**
1. **Option A** — description. Tradeoff: ...
2. **Option B** — description. Tradeoff: ...

**Blocking:** <What tasks or features are blocked until this is resolved? Or "Nothing currently blocked.">

**See also:** <links to related docs or tasks>
```

---

## Resolved Decision Template

```
### RESOLVED-XX — <Short Decision Title>

**Resolved:** YYYY-MM-DD

**Decision:** <The choice that was made. State it precisely.>

**Why:** <The rationale. What constraints, data, or priorities drove this choice?>

**Alternatives rejected:** <What was considered and why it was ruled out.>

**Affects:** <Which parts of the system or which docs are impacted. Link them.>
```

---

## Open Decisions

### OPEN-01 — Icon and spritesheet art generation via pet hatch skill

**Question:** Should buddy adopt the Codex pet hatch skill as the canonical workflow for generating `build/icon.ico` and final `pets/default/spritesheet.webp` artwork?

**Context:** The codex pet hatch skill is a markdown-driven image-generation workflow that produces Codex-compatible pixel-art spritesheets and accompanying `pet.json` state machines. Using it for buddy means: (a) the same tool that generates Codex pets generates buddy's default pet, keeping the two ecosystems consistent; (b) future users who want a custom pet already have a familiar workflow. Currently `build/icon.ico` is absent (blocking the full installer build) and `pets/default/spritesheet.webp` is a color-grid placeholder. The pet hatch skill was not planned at project start but fits naturally; adopting it will require adapting the skill's prompts and output paths for the buddy context.

**Options under consideration:**
1. **Adopt pet hatch skill (adapted)** — edit the skill's markdown to output `build/icon.ico` and `pets/default/spritesheet.webp` at the correct dimensions. The skill becomes the canonical art-generation path going forward. Tradeoff: requires skill editing work; adds an optional dependency on Codex image generation.
2. **Bespoke static assets** — commission or hand-craft `icon.ico` and `spritesheet.webp` separately, commit them as binary blobs. Tradeoff: simpler dependency graph but no repeatable generation workflow; harder to retheme.

**Blocking:** Full release build (`npm run build`) fails without `build/icon.ico`. The placeholder spritesheet unblocks development but is not shippable. Tracks as `ASSET-01` on the workboard.

**See also:** [`docs/ARCHITECTURE.md`](ARCHITECTURE.md), [`docs/workboard.json`](workboard.json)

---

## Resolved Decisions

### RESOLVED-01 — Electron + Svelte over Tauri

**Resolved:** 2026-05-21

**Decision:** Use Electron for the main process and Svelte + TypeScript + Vite for the renderer.

**Why:** Electron's BrowserWindow API gives precise control over transparent overlays on Windows — specifically `thickFrame: false`, `roundedCorners: false`, `setIgnoreMouseEvents`, and `showInactive`. These behaviors are critical for a frameless, click-through pet overlay and are not reliably accessible through Tauri's WebView2 wrapper.

**Alternatives rejected:** Tauri (insufficient low-level Windows overlay control via WebView2); plain Win32 (excessive boilerplate with no web renderer, making sprite animation and state UI impractical).

**Affects:** [ARCHITECTURE.md](ARCHITECTURE.md), [CONVENTIONS.md](CONVENTIONS.md)

---

### RESOLVED-02 — Rust for petdex-bridge (WSL bridge CLI)

**Resolved:** 2026-05-21

**Decision:** petdex-bridge is a Rust binary cross-compiled to `x86_64-unknown-linux-gnu` for execution inside WSL.

**Why:** Rust cross-compiles cleanly to Linux (for WSL) with zero runtime dependencies. The resulting binary is ~2 MB, starts in milliseconds, and can be called directly from shell hooks (`.zshrc`/`.bashrc`) without requiring Node, Python, or any other runtime to be present in the WSL environment.

**Alternatives rejected:** Node.js script (requires Node installed in WSL, slow startup latency for a hook); Go (viable but Rust fits the project's existing preferences); Python (too heavy for a lightweight hook bridge invoked on every tool call).

**Affects:** [ARCHITECTURE.md](ARCHITECTURE.md)

---

### RESOLVED-03 — Codex-compatible sprite sheet format

**Resolved:** 2026-05-21

**Decision:** Use Codex's pixel-art sprite sheet format — an 8-column × 9-row PNG/WebP grid with a companion JSON state machine that defines frame sequences per named pet state.

**Why:** Direct format compatibility means sprites already present in `~/.codex/pets` can be used in buddy without any conversion step. The format is simple to render with CSS `background-position` animation, well-understood from the open-source Codex implementation, and supports all required pet states (idle, running, waiting, jumping, waving, failed, review).

**Alternatives rejected:** Lottie (incompatible with existing Codex pixel-art sprites and requires vector artwork); CSS/SVG animation (insufficient expressiveness for multi-state, frame-by-frame pixel art).

**Affects:** [CONVENTIONS.md](CONVENTIONS.md)

---

### RESOLVED-04 — Local HTTP transport for hook events

**Resolved:** 2026-05-21

**Decision:** Hook events are delivered via `POST http://127.0.0.1:7777/state` (port configurable via `BUDDY_PORT`). The Electron sidecar listens on this port. petdex-bridge running in WSL reaches the Windows host using WSL's automatic localhost passthrough.

**Why:** WSL2 automatically routes `localhost` traffic to the Windows host, making HTTP the simplest possible cross-boundary transport. HTTP is language-agnostic (any hook script can use `curl` or `petdex-bridge`), debuggable with standard tools, and requires no special IPC setup or kernel-level configuration. The token-based auth header (`X-Petdex-Update-Token`) provides sufficient security since the server is bound to loopback only.

**Alternatives rejected:** Windows named pipes (fragile and inconsistently accessible from WSL2); Unix sockets (not available cross-OS between WSL and Windows); stdout/stdin relay (requires a persistent process attached to the hook, which is impractical for shell hooks).

**Affects:** [ARCHITECTURE.md](ARCHITECTURE.md), [ENV_VARS.md](ENV_VARS.md)
