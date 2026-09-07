import { app, BrowserWindow, ipcMain, screen } from "electron";
import { fileURLToPath } from "node:url";

const PET_SIZE = 100;
const EMOTION_OVERLAY_SIZE = 400;
let petWindow;
let emotionOverlayWindow;
let emotionMenuCloseReason;

// 💡 드래그가 시작될 때의 창 위치를 기억할 변수를 선언합니다.
let startWindowX = 0;
let startWindowY = 0;

function createWindow() {
  const preloadPath = fileURLToPath(new URL("preload.js", import.meta.url));

  if (process.platform === "win32") {
    app.commandLine.appendSwitch("disable-features", "WinUseBrowserSpellChecker");
  }

  petWindow = new BrowserWindow({
    width: PET_SIZE,
    height: PET_SIZE,
    minWidth: PET_SIZE,
    maxWidth: PET_SIZE,
    minHeight: PET_SIZE,
    maxHeight: PET_SIZE,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    thickFrame: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
    },
  });

  petWindow.loadURL("http://localhost:5173");

  // DevTools는 분리된 창으로 띄운다 (투명 petWindow 안에 docked로 열면 레이아웃 꼬임)
  //petWindow.webContents.openDevTools({ mode: "detach" });

  // 핵심: 어떤 이유로든 리사이즈 시도 자체를 원천 차단 + 로그로 원인 확인
  petWindow.on("will-resize", (event, newBounds) => {
    console.log("OS가 리사이즈 요청함:", newBounds, "현재:", petWindow.getBounds());
    event.preventDefault();
  });

  // 혹시 will-resize를 뚫고 실제로 리사이즈가 발생하는지도 확인
  petWindow.on("resize", () => {
    console.log("실제 RESIZE 발생함! 현재 크기:", petWindow.getSize());
  });

  // 💡 1. 드래그 시작 시점의 창 위치를 기록하는 이벤트를 새로 추가합니다.
  ipcMain.on("pet:start-drag", () => {
    if (!petWindow || emotionOverlayWindow) return;
    const [x, y] = petWindow.getPosition();
    startWindowX = x;
    startWindowY = y;
    console.log("드래그 시작 - 창 초기 위치 기록:", { startWindowX, startWindowY });
  });

  // 💡 2. 기존의 pet:move 이벤트를 누적 이동 거리(Delta) 방식으로 수정합니다.
  ipcMain.on("pet:move", (_, bx, by, ax, ay) => {
    if (!petWindow || emotionOverlayWindow) return;

    // bx, by: 처음 마우스를 클릭한 절대 좌표 (고정값)
    // ax, ay: 현재 마우스가 움직이고 있는 절대 좌표 (가변값)
    const dx = ax - bx; // 처음 클릭 지점으로부터 마우스가 움직인 총 거리
    const dy = ay - by;

    // 💡 마우스 상대 이동량을 처음 창 위치에 더하므로, 창이 이동해도 좌표계가 튀지 않습니다.
    // 기존의 Math.abs(dx) > 150 예외 처리 코드는 좌표가 튀지 않으므로 불필요해져 제거했습니다.
    const targetX = startWindowX + dx;
    const targetY = startWindowY + dy;

    // 화면 작업 영역 구하기 및 화면 이탈 방지 제한 (기존 로직 유지)
    const display = screen.getDisplayNearestPoint({ x: startWindowX, y: startWindowY });
    const { x: minX, y: minY, width, height } = display.workArea;

    const newX = Math.min(Math.max(targetX, minX), minX + width - PET_SIZE);
    const newY = Math.min(Math.max(targetY, minY), minY + height - PET_SIZE);

    petWindow.setBounds({
      x: newX,
      y: newY,
      width: PET_SIZE,
      height: PET_SIZE,
    });
  });

  ipcMain.on("pet:auto-move", (_, deltaX) => {
    if (!petWindow || emotionOverlayWindow) return;

    const { x, y } = petWindow.getBounds();
    const display = screen.getDisplayNearestPoint({ x, y });
    const { x: minX, width } = display.workArea;
    const maxX = minX + width - PET_SIZE;
    const nextX = Math.min(Math.max(x + deltaX, minX), maxX);

    petWindow.setBounds({
      x: nextX,
      y,
      width: PET_SIZE,
      height: PET_SIZE,
    });

    if (nextX !== x && (nextX === minX || nextX === maxX)) {
      petWindow.webContents.send("pet:auto-boundary");
    }
  });

  ipcMain.on("pet:open-emotion-menu", () => {
    if (!petWindow || emotionOverlayWindow) return;

    const { x, y } = petWindow.getBounds();
    const display = screen.getDisplayNearestPoint({ x: x + PET_SIZE / 2, y: y + PET_SIZE / 2 });
    const { x: minX, y: minY, width, height } = display.workArea;
    const overlayX = Math.min(
      Math.max(x + PET_SIZE / 2 - EMOTION_OVERLAY_SIZE / 2, minX),
      minX + width - EMOTION_OVERLAY_SIZE,
    );
    const overlayY = Math.min(
      Math.max(y + PET_SIZE / 2 - EMOTION_OVERLAY_SIZE / 2, minY),
      minY + height - EMOTION_OVERLAY_SIZE,
    );
    const preloadPath = fileURLToPath(new URL("preload.js", import.meta.url));

    emotionOverlayWindow = new BrowserWindow({
      width: EMOTION_OVERLAY_SIZE,
      height: EMOTION_OVERLAY_SIZE,
      x: overlayX,
      y: overlayY,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      hasShadow: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
      },
    });

    emotionOverlayWindow.loadURL("http://localhost:5173/?window=emotion-menu");
    emotionOverlayWindow.on("closed", () => {
      console.log("[EMOTION_MENU_CLOSED] 오버레이 메뉴가 닫혔습니다");
      const closeReason = emotionMenuCloseReason;
      emotionMenuCloseReason = undefined;
      emotionOverlayWindow = undefined;
      if (petWindow && !petWindow.isDestroyed()) {
        console.log("[EMOTION_MENU_CLOSED] 펫 창에 닫힘 신호를 전달합니다");
        petWindow.webContents.send("pet:emotion-menu-closed", closeReason);
      }
    });
  });

  const closeEmotionMenu = (reason) => {
    if (emotionOverlayWindow && !emotionOverlayWindow.isDestroyed()) {
      console.log("[CLOSE_EMOTION_SIGNAL] 메뉴 닫기 신호 수신됨");
      emotionMenuCloseReason = reason;
      emotionOverlayWindow.close();
      return;
    }

    console.log("[CLOSE_EMOTION_SIGNAL] 닫을 오버레이가 없습니다");
  };

  ipcMain.on("pet:close-emotion-menu", (_, reason) => closeEmotionMenu(reason));
  ipcMain.on("pet:select-emotion", (_, emotion) => {
    console.log(`[emotion] 선택됨: ${emotion}`);
    if (emotion === "💤") {
      console.log("[SLEEP_SIGNAL] sleep 기능 신호 수신됨");
    }

    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send("pet:emotion-selected", emotion);
    }
    closeEmotionMenu();
  });
}

app.whenReady().then(() => {
  createWindow();
});
