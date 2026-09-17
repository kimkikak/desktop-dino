import { app, BrowserWindow, ipcMain, screen } from "electron";
import { fileURLToPath } from "node:url";

const PET_SIZE = 100;
const FRAME_PADDING = 1;
const TAIL_OFFSET_X = PET_SIZE / 2.7;
const TAIL_OFFSET_Y = PET_SIZE * 0.05;
const EMOTION_OVERLAY_SIZE = 400;
const SETTINGS_WINDOW_WIDTH = 430;
const SETTINGS_WINDOW_HEIGHT = 280;
let petWindow;
let emotionOverlayWindow;
let settingsWindow;
let emotionMenuCloseReason;
let petScale = 1;
let borderEnabled = false;
let pettingMode = false;
let petImageSize = { width: PET_SIZE, height: PET_SIZE };

// 💡 드래그가 시작될 때의 창 위치를 기억할 변수를 선언합니다.
let startWindowX = 0;
let startWindowY = 0;
let boundaryNotified = false;
let isProgrammaticResize = false;

// 💡 자동 이동(auto-move)의 소수점 이하 이동량이 매 프레임 정수 좌표로
// 잘려나가지 않도록, 정수로 반올림하기 전의 실수 좌표를 별도로 추적합니다.
// 드래그/스케일 변경 등 다른 경로로 창 위치가 바뀔 때마다 이 값도 함께 맞춰줍니다.
let autoMoveX = null;

// 💡 petImageSize/petScale로부터 창 크기를 계산합니다. 드래그 중에는 이 값을
// 써야 하며, petWindow.getBounds()의 width/height를 그대로 되먹이면 안 됩니다.
// (모니터 간 DPI 재해석 등으로 OS가 순간적으로 다른 크기를 보고할 경우
// 그 값이 다시 setBounds에 그대로 들어가 창이 커지는 것처럼 보일 수 있습니다.)
function computeWindowSize() {
  return {
    width: Math.max(1, Math.round(petImageSize.width * petScale) + FRAME_PADDING * 2),
    height: Math.max(1, Math.round(petImageSize.height * petScale) + FRAME_PADDING * 2),
  };
}

function createWindow() {
  const preloadPath = fileURLToPath(new URL("preload.js", import.meta.url));
  const iconPath = app.isPackaged
    ? fileURLToPath(new URL("../dist/pet/icon.png", import.meta.url))
    : fileURLToPath(new URL("../public/pet/icon.png", import.meta.url));

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
    icon: iconPath,
    hasShadow: false,
    thickFrame: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
    },
  });
  petWindow.setAlwaysOnTop(true, "floating");
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (app.isPackaged) {
    petWindow.loadFile(fileURLToPath(new URL("../dist/index.html", import.meta.url)));
  } else {
    petWindow.loadURL("http://localhost:5173");
  }

  // DevTools는 분리된 창으로 띄운다 (투명 petWindow 안에 docked로 열면 레이아웃 꼬임)
  if (!app.isPackaged) {
    petWindow.webContents.openDevTools({ mode: "detach" });
  }

  // 핵심: 어떤 이유로든 리사이즈 시도 자체를 원천 차단 + 로그로 원인 확인
  petWindow.on("will-resize", (event, newBounds) => {
    console.log("OS가 리사이즈 요청함:", newBounds, "현재:", petWindow.getBounds(), {
      programmatic: isProgrammaticResize,
      action: isProgrammaticResize ? "통과" : "차단",
    });
    if (!isProgrammaticResize) {
      event.preventDefault();
    }
  });

  // 혹시 will-resize를 뚫고 실제로 리사이즈가 발생하는지도 확인
  petWindow.on("resize", () => {
    console.log("실제 RESIZE 발생함! 현재 크기:", petWindow.getSize());
  });

  ipcMain.on("pet:resize", (_, requestedWidth, requestedHeight) => {
    if (!petWindow || emotionOverlayWindow) return;

    petImageSize = {
      width: Math.max(1, Math.round(requestedWidth)),
      height: Math.max(1, Math.round(requestedHeight)),
    };
    console.log("[RESIZE]", {
      width: requestedWidth,
      height: requestedHeight,
      before: petWindow.getBounds(),
    });
    const { width, height } = computeWindowSize();
    const { x, y, width: currentWidth, height: currentHeight } = petWindow.getBounds();
    const TOLERANCE = 2;
    if (
      Math.abs(width - currentWidth) <= TOLERANCE
      && Math.abs(height - currentHeight) <= TOLERANCE
    ) {
      return;
    }

    isProgrammaticResize = true;
    try {
      petWindow.setMinimumSize(1, 1);
      petWindow.setMaximumSize(width, height);
      petWindow.setMinimumSize(width, height);
      petWindow.setBounds({ x, y, width, height });
    } finally {
      isProgrammaticResize = false;
    }
  });

  // 💡 1. 드래그 시작 시점의 창 위치를 기록하는 이벤트를 새로 추가합니다.
  ipcMain.on("pet:start-drag", (_, direction, cursorX, cursorY) => {
    if (!petWindow || emotionOverlayWindow) return;
    const { x, y } = petWindow.getBounds();
    const { width: currentWidth, height: currentHeight } = computeWindowSize();
    const tailOffsetX = FRAME_PADDING + TAIL_OFFSET_X * petScale;
    const tailOffsetY = FRAME_PADDING + TAIL_OFFSET_Y * petScale;
    const tailOffsetFromWindow = direction === 1
      ? tailOffsetX
      : currentWidth - tailOffsetX;
    const display = screen.getDisplayNearestPoint({ x, y });
    const { x: minX, y: minY, width, height } = display.workArea;
    const targetX = cursorX - tailOffsetFromWindow;
    const targetY = cursorY - tailOffsetY;
    startWindowX = Math.min(Math.max(targetX, minX), minX + width - currentWidth);
    startWindowY = Math.min(Math.max(targetY, minY), minY + height - currentHeight);
    boundaryNotified = false;
    autoMoveX = startWindowX;

    petWindow.setBounds({
      x: startWindowX,
      y: startWindowY,
      width: currentWidth,
      height: currentHeight,
    });

    console.log("드래그 시작 - 창 초기 위치 기록:", { startWindowX, startWindowY });
  });

  // 💡 2. 기존의 pet:move 이벤트를 누적 이동 거리(Delta) 방식으로 수정합니다.
  ipcMain.on("pet:move", (_, bx, by, ax, ay) => {
    if (!petWindow || emotionOverlayWindow) return;

    console.log("[PET_MOVE_CALLED]", {
      bx,
      by,
      ax,
      ay,
      current: petWindow.getBounds(),
    });

    // bx, by: 처음 마우스를 클릭한 절대 좌표 (고정값)
    // ax, ay: 현재 마우스가 움직이고 있는 절대 좌표 (가변값)
    const dx = ax - bx; // 처음 클릭 지점으로부터 마우스가 움직인 총 거리
    const dy = ay - by;

    // 💡 마우스 상대 이동량을 처음 창 위치에 더하므로, 창이 이동해도 좌표계가 튀지 않습니다.
    // 기존의 Math.abs(dx) > 150 예외 처리 코드는 좌표가 튀지 않으므로 불필요해져 제거했습니다.
    const targetX = startWindowX + dx;
    const targetY = startWindowY + dy;

    // 화면 작업 영역 구하기 및 화면 이탈 방지 제한 (기존 로직 유지)
    // 💡 창 크기는 OS에서 다시 읽지 않고 petImageSize/petScale로 직접 계산합니다.
    // getBounds().width/height를 그대로 되먹이면, 드래그 중 모니터 간 DPI 재해석 등으로
    // OS가 순간적으로 다른 크기를 보고할 때 그 값이 그대로 적용되어 창이 커지는 것처럼
    // 보일 수 있습니다.
    const { width: currentWidth, height: currentHeight } = computeWindowSize();
    const display = screen.getDisplayNearestPoint({ x: startWindowX, y: startWindowY });
    const { x: minX, y: minY, width, height } = display.workArea;

    const newX = Math.min(Math.max(targetX, minX), minX + width - currentWidth);
    const newY = Math.min(Math.max(targetY, minY), minY + height - currentHeight);
    autoMoveX = newX;

    petWindow.setBounds({
      x: newX,
      y: newY,
      width: currentWidth,
      height: currentHeight,
    });
  });

  ipcMain.on("pet:auto-move", (_, deltaX) => {
    if (!petWindow || emotionOverlayWindow) return;

    const currentBounds = petWindow.getBounds();
    const { y } = currentBounds;
    const { width: currentWidth, height: currentHeight } = computeWindowSize();
    // 💡 창 좌표(getBounds)는 항상 정수라, 이걸 기준으로 매번 다시 시작하면
    // 1px 미만의 소수점 이동량(느린 걷기 속도 + 높은 주사율에서 흔함)이
    // 반올림 과정에서 매 프레임 사라져 버립니다. autoMoveX에 소수점까지
    // 누적해두고, 실제 창 이동에만 반올림한 값을 사용합니다.
    const baseX = autoMoveX ?? currentBounds.x;
    console.log("[AUTO_MOVE]", { deltaX, before: currentBounds, baseX });
    const display = screen.getDisplayNearestPoint({ x: Math.round(baseX), y });
    const { x: minX, width } = display.workArea;
    const maxX = minX + width - currentWidth;
    const targetX = Math.min(Math.max(baseX + deltaX, minX), maxX);
    autoMoveX = targetX;
    const nextX = Math.round(targetX);
    const atLeftBoundary = targetX === minX;
    const atRightBoundary = targetX === maxX;
    const movingIntoBoundary = (atLeftBoundary && deltaX < 0) || (atRightBoundary && deltaX > 0);

    if (!atLeftBoundary && !atRightBoundary || !movingIntoBoundary) {
      boundaryNotified = false;
    }

    petWindow.setBounds({
      x: nextX,
      y,
      width: currentWidth,
      height: currentHeight,
    });

    if (movingIntoBoundary && !boundaryNotified) {
      boundaryNotified = true;
      petWindow.webContents.send("pet:auto-boundary");
    }
  });

  ipcMain.on("pet:open-emotion-menu", () => {
    if (!petWindow || emotionOverlayWindow) return;

    const { x, y, width: currentWidth, height: currentHeight } = petWindow.getBounds();
    const display = screen.getDisplayNearestPoint({ x: x + currentWidth / 2, y: y + currentHeight / 2 });
    const { x: minX, y: minY, width, height } = display.workArea;
    const overlayX = Math.round(Math.min(
      Math.max(x + currentWidth / 2 - EMOTION_OVERLAY_SIZE / 2, minX),
      minX + width - EMOTION_OVERLAY_SIZE,
    ));
    const overlayY = Math.round(Math.min(
      Math.max(y + currentHeight / 2 - EMOTION_OVERLAY_SIZE / 2, minY),
      minY + height - EMOTION_OVERLAY_SIZE,
    ));
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
    emotionOverlayWindow.setPosition(overlayX, overlayY);

    const emotionMenuUrl = app.isPackaged
      ? `file://${fileURLToPath(new URL("../dist/index.html", import.meta.url))}?window=emotion-menu`
      : "http://localhost:5173/?window=emotion-menu";
    emotionOverlayWindow.loadURL(emotionMenuUrl);
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

  function openSettingsWindow() {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.focus();
      return;
    }

    const { x, y, width, height } = petWindow.getBounds();
    const display = screen.getDisplayNearestPoint({ x, y });
    const { x: minX, y: minY, width: workWidth, height: workHeight } = display.workArea;
    const settingsX = Math.round(Math.min(
      Math.max(x + width / 2 - SETTINGS_WINDOW_WIDTH / 2, minX),
      minX + workWidth - SETTINGS_WINDOW_WIDTH,
    ));
    const settingsY = Math.round(Math.min(
      Math.max(y + height + 12, minY),
      minY + workHeight - SETTINGS_WINDOW_HEIGHT,
    ));
    const preloadPath = fileURLToPath(new URL("preload.js", import.meta.url));
    settingsWindow = new BrowserWindow({
      width: SETTINGS_WINDOW_WIDTH,
      height: SETTINGS_WINDOW_HEIGHT,
      x: settingsX,
      y: settingsY,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
      },
    });

    const settingsUrl = app.isPackaged
      ? `file://${fileURLToPath(new URL("../dist/index.html", import.meta.url))}?window=settings&scale=${petScale}&border=${borderEnabled}`
      : `http://localhost:5173/?window=settings&scale=${petScale}&border=${borderEnabled}`;
    settingsWindow.loadURL(settingsUrl);
    settingsWindow.on("closed", () => {
      settingsWindow = undefined;
    });
  }

  ipcMain.on("pet:open-settings", () => {
    openSettingsWindow();
  });

  ipcMain.on("pet:close-settings", () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
  });

  ipcMain.on("pet:set-scale", (_, requestedScale) => {
    if (!petWindow || !Number.isFinite(requestedScale)) return;

    petScale = Math.min(2, Math.max(0.5, Number(requestedScale)));
    const { width, height } = computeWindowSize();
    const { x, y, width: currentWidth, height: currentHeight } = petWindow.getBounds();
    const centeredX = Math.round(x - (width - currentWidth) / 2);
    const centeredY = Math.round(y - (height - currentHeight) / 2);
    autoMoveX = centeredX;
    isProgrammaticResize = true;
    try {
      petWindow.setMinimumSize(1, 1);
      petWindow.setMaximumSize(width, height);
      petWindow.setMinimumSize(width, height);
      petWindow.setBounds({ x: centeredX, y: centeredY, width, height });
    } finally {
      isProgrammaticResize = false;
    }
    petWindow.webContents.send("pet:scale-changed", petScale);
  });

  ipcMain.on("pet:set-border-enabled", (_, enabled) => {
    borderEnabled = Boolean(enabled);
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send("pet:border-enabled-changed", borderEnabled);
    }
  });

  ipcMain.on("pet:set-petting-mode", (_, enabled) => {
    pettingMode = Boolean(enabled);
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
    if (emotion === "settings") {
      closeEmotionMenu();
      openSettingsWindow();
      return;
    }
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
