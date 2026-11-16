import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { API_METHODS, type IpcResult, type MainEvent } from '../shared/api'

const api: Record<string, unknown> = {}
for (const m of API_METHODS) {
  api[m] = async (...args: unknown[]) => {
    const r = (await ipcRenderer.invoke('api', m, ...args)) as IpcResult<unknown>
    if (!r.ok) throw new Error(r.error)
    return r.value
  }
}
api.on = (event: MainEvent, cb: () => void) => {
  const listener = (_: unknown, e: MainEvent) => {
    if (e === event) cb()
  }
  ipcRenderer.on('event', listener)
  return () => ipcRenderer.removeListener('event', listener)
}
/** Absolute path of a dropped File (Electron removed File.path). */
api.pathForFile = (f: File) => webUtils.getPathForFile(f)

contextBridge.exposeInMainWorld('api', api)
