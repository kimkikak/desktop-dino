const { contextBridge, ipcRenderer } = require("electron");

console.log("preload.js loaded");

contextBridge.exposeInMainWorld("electronAPI", {
  movePet: (bx, by, ax, ay) => ipcRenderer.send("pet:move", bx, by, ax, ay),
  startDrag: () => ipcRenderer.send("pet:start-drag"), // 💡 이 줄을 꼭 추가해 주세요!
});