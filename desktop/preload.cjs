/**
 * The only bridge between the renderer and the main process. Context
 * isolation is on, so the page sees exactly this surface and nothing else —
 * in particular it never sees the API key.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jarvisDesktop", {
  isDesktop: true,

  health: () => ipcRenderer.invoke("jarvis:health"),
  ask: (message, history) => ipcRenderer.invoke("jarvis:ask", { message, history }),
  transcribe: (buffer) => ipcRenderer.invoke("jarvis:transcribe", buffer),

  settings: (patch) => ipcRenderer.invoke("jarvis:settings", patch),

  show: () => ipcRenderer.send("jarvis:show"),
  hide: () => ipcRenderer.send("jarvis:hide"),
  clapWake: () => ipcRenderer.send("jarvis:clap-wake"),

  onWake: (handler) => ipcRenderer.on("jarvis:wake", (event, source) => handler(source)),
  onListening: (handler) => ipcRenderer.on("jarvis:listening", (event, on) => handler(on)),
  onOpenSettings: (handler) => ipcRenderer.on("jarvis:open-settings", () => handler()),
});
