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
});