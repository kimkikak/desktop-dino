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
  resizePet: (width, height) => ipcRenderer.send("pet:resize", width, height),
  openEmotionMenu: () => ipcRenderer.send("pet:open-emotion-menu"),
  openSettings: () => ipcRenderer.send("pet:open-settings"),
  selectEmotion: (emotion) => ipcRenderer.send("pet:select-emotion", emotion),
  closeEmotionMenu: (reason) => ipcRenderer.send("pet:close-emotion-menu", reason),
  closeSettings: () => ipcRenderer.send("pet:close-settings"),
  setPetScale: (scale) => ipcRenderer.send("pet:set-scale", scale),
  setPettingMode: (enabled) => ipcRenderer.send("pet:set-petting-mode", enabled),
  quitApp: () => ipcRenderer.send("pet:quit-app"),
  onPetScaleChanged: (callback) => {
    const listener = (_, scale) => callback(scale);
    ipcRenderer.on("pet:scale-changed", listener);
    return () => ipcRenderer.removeListener("pet:scale-changed", listener);
  },
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