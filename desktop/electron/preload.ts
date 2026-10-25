import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { ELECTRON_BRIDGE_KEY, type ElectronShellBridge } from '../src/lib/shell/electronBridge'

const bridge: ElectronShellBridge = {
  invoke: (command, args) => ipcRenderer.invoke('shell:invoke', command, args),
  listen: (event, handler) => {
    const listener = (_event: IpcRendererEvent, name: string, payload: unknown) => {
      if (name === event) handler(payload)
    }
    ipcRenderer.on('shell:event', listener)
    return () => {
      ipcRenderer.removeListener('shell:event', listener)
    }
  },
}

contextBridge.exposeInMainWorld(ELECTRON_BRIDGE_KEY, bridge)
