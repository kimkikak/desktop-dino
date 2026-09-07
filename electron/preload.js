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
  startDrag: () => ipcRenderer.send("pet:start-drag"), // 💡 이 줄을 꼭 추가해 주세요!
  openEmotionMenu: () => ipcRenderer.send("pet:open-emotion-menu"),
  selectEmotion: (emotion) => ipcRenderer.send("pet:select-emotion", emotion),
  closeEmotionMenu: () => ipcRenderer.send("pet:close-emotion-menu"),
  onEmotionSelected: (callback) => {
    const listener = (_, emotion) => callback(emotion);
    ipcRenderer.on("pet:emotion-selected", listener);
    return () => ipcRenderer.removeListener("pet:emotion-selected", listener);
  },
  onEmotionMenuClosed: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("pet:emotion-menu-closed", listener);
    return () => ipcRenderer.removeListener("pet:emotion-menu-closed", listener);
  },
});