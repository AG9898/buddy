import { contextBridge } from 'electron'

// FEAT-02: expose petApi to renderer via contextBridge
// Channel name constants and full API defined in this task.

contextBridge.exposeInMainWorld('petApi', {})
