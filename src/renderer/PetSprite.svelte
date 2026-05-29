<script lang="ts">
  import { onDestroy } from 'svelte'

  // --- Props ---
  interface Props {
    state: string
    pet: PetManifest
    spritesheetUrl: string
  }
  let { state: petState, pet, spritesheetUrl }: Props = $props()

  // --- Constants from pet.json ---
  const COLUMNS = $derived(pet.columns)
  const ROWS = $derived(pet.rows)
  const FRAME_WIDTH = $derived(pet.frameWidth)
  const FRAME_HEIGHT = $derived(pet.frameHeight)

  // background-size: "800% 900%" for 8 cols × 9 rows
  const BG_SIZE = $derived(`${COLUMNS * 100}% ${ROWS * 100}%`)

  // --- Reactive display state ---
  let bgPosition = $state('0% 0%')
  let dragging = false

  // Timer handle — null when no animation is running
  let timerId: ReturnType<typeof setTimeout> | null = null
  // Version counter: increment to cancel any in-flight animation cycle
  let animVersion = 0

  function frameToPosition(frame: PetFrame): string {
    const xPct = COLUMNS > 1 ? (frame.col / (COLUMNS - 1)) * 100 : 0
    const yPct = ROWS > 1 ? (frame.row / (ROWS - 1)) * 100 : 0
    return `${xPct}% ${yPct}%`
  }

  function clearAnimation(): void {
    animVersion++
    if (timerId !== null) {
      clearTimeout(timerId)
      timerId = null
    }
  }

  function getStateDef(stateName: string): PetStateDefinition {
    return pet.states[stateName] ?? pet.states['idle']
  }

  function startAnimation(stateName: string): void {
    clearAnimation()
    const version = animVersion

    const def = getStateDef(stateName)
    const frames = def.frames
    if (frames.length === 0) return

    // Show first frame immediately
    bgPosition = frameToPosition(frames[0])

    let idx = 0

    function scheduleNext(): void {
      if (animVersion !== version) return // stale — a newer animation started
      const frame = frames[idx]
      timerId = setTimeout(() => {
        if (animVersion !== version) return
        idx++
        if (idx >= frames.length) {
          if (def.once) {
            // One-shot complete: jump to fallback
            startAnimation(def.fallback ?? 'idle')
            return
          }
          idx = 0
        }
        bgPosition = frameToPosition(frames[idx])
        scheduleNext()
      }, frame.ms)
    }

    scheduleNext()
  }

  // Re-run animation whenever petState prop changes
  $effect(() => {
    startAnimation(petState)
  })

  onDestroy(() => {
    clearAnimation()
  })

  // --- Resize state ---
  let resizing = false

  // --- Pointer interactivity (window-level) ---
  // Both the pet sprite and the resize handle are interactive regions.
  function onWindowPointerMove(event: PointerEvent): void {
    const target = event.target as Element | null
    const isOver =
      target?.closest('[data-avatar-mascot]') !== null ||
      target?.closest('.resize-handle') !== null
    window.petApi.setPointerInteractive(isOver)

    // Forward move events during an active resize.
    if (resizing) {
      window.petApi.resizeMove(event.screenX, event.screenY)
    }
  }

  // --- Drag handling (div-level) ---
  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return
    dragging = true
    ;(event.currentTarget as Element).setPointerCapture(event.pointerId)
    window.petApi.dragStart(event.offsetX, event.offsetY)
  }

  function onPointerMoveDiv(): void {
    if (dragging) {
      window.petApi.dragMove()
    }
  }

  function onPointerUp(event: PointerEvent): void {
    if (!dragging) return
    dragging = false
    ;(event.currentTarget as Element).releasePointerCapture(event.pointerId)
    window.petApi.dragEnd()
  }

  // --- Resize handle handling ---
  function onResizePointerDown(event: PointerEvent): void {
    if (event.button !== 0) return
    event.stopPropagation() // do not trigger drag
    resizing = true
    ;(event.currentTarget as Element).setPointerCapture(event.pointerId)
    window.petApi.resizeStart(FRAME_WIDTH, FRAME_HEIGHT)
  }

  function onResizePointerUp(event: PointerEvent): void {
    if (!resizing) return
    resizing = false
    ;(event.currentTarget as Element).releasePointerCapture(event.pointerId)
    window.petApi.resizeEnd()
  }
</script>

<svelte:window onpointermove={onWindowPointerMove} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="pet-container"
  style="--frame-aspect: {FRAME_WIDTH / FRAME_HEIGHT};"
>
  <div
    data-avatar-mascot="true"
    style="
      width: 100%;
      height: 100%;
      background-image: url('{spritesheetUrl}');
      background-size: {BG_SIZE};
      background-position: {bgPosition};
      background-repeat: no-repeat;
      cursor: grab;
      user-select: none;
    "
    onpointerdown={onPointerDown}
    onpointermove={onPointerMoveDiv}
    onpointerup={onPointerUp}
  ></div>
  <!-- Resize handle: bottom-right corner, visible on hover -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="resize-handle"
    onpointerdown={onResizePointerDown}
    onpointerup={onResizePointerUp}
  ></div>
</div>
