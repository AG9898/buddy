// IPC channel name constants. Keep this module side-effect-free so it can be
// imported by main, preload, and tests without executing Electron bridge code.
export const CH_STATE_SET = 'state-set'
export const CH_STATE_CHANGE = 'pet:state-change'
export const CH_PTR_INTERACTIVE = 'ptr-interactive-changed'
export const CH_DRAG_START = 'drag-start'
export const CH_DRAG_MOVE = 'drag-move'
export const CH_DRAG_END = 'drag-end'
export const CH_RENDERER_READY = 'renderer-ready'
