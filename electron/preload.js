const { contextBridge, ipcRenderer } = require("electron");

console.log("preload.js loaded");

contextBridge.exposeInMainWorld("electronAPI", {
  movePet: (bx, by, ax, ay) => ipcRenderer.send("pet:move", bx, by, ax, ay),
  autoMove: (deltaX) => ipcRenderer.send("pet:auto-move", deltaX),
  onAutoBoundary: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("pet:auto-boundary", listener);
    return () => ipcRenderer.removeListener("pet:auto-boundary", listener);
  },
  startDrag: (direction, cursorX, cursorY) => ipcRenderer.send("pet:start-drag", direction, cursorX, cursorY),
  openEmotionMenu: () => ipcRenderer.send("pet:open-emotion-menu"),
  selectEmotion: (emotion) => ipcRenderer.send("pet:select-emotion", emotion),
  closeEmotionMenu: (reason) => ipcRenderer.send("pet:close-emotion-menu", reason),
  onEmotionSelected: (callback) => {
    const listener = (_, emotion) => callback(emotion);
    ipcRenderer.on("pet:emotion-selected", listener);
    return () => ipcRenderer.removeListener("pet:emotion-selected", listener);
  },
  onEmotionMenuClosed: (callback) => {
    const listener = (_, reason) => callback(reason);
    ipcRenderer.on("pet:emotion-menu-closed", listener);
    return () => ipcRenderer.removeListener("pet:emotion-menu-closed", listener);
  },
});