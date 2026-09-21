import { useState, useEffect, useRef } from "react";

type AutoState = "idle" | "walk" | "fastrun" | "sleep" | "eating" | "work" | "roar" | "petting";
const isEmotionMenu = new URLSearchParams(window.location.search).get("window") === "emotion-menu";
const isSettingsWindow = new URLSearchParams(window.location.search).get("window") === "settings";
const cursorHotspots = {
  "hand1.png": { x: 130, y: 65 },
  "hand2.png": { x: 125, y: 58 },
} as const;
const emotions = [
  { value: "feed", label: "🍖", ariaLabel: "밥주기" },
  { value: "work", label: "💻", ariaLabel: "작업" },
  { value: "love", label: "❤️", ariaLabel: "❤️" },
  { value: "settings", label: "⚙️", ariaLabel: "설정" },
];

// 공룡 몸 색깔 커스터마이징: 스프라이트의 몸통 부분은 이 크로마키 색으로
// 미리 칠해져 있고, 이 색과 정확히 일치하는 픽셀만 사용자가 고른 색으로 치환한다.
const CHROMA_KEY_HEX = "#FF00FF";
const DEFAULT_PET_COLOR = "#000000";
const PET_COLOR_STORAGE_KEY = "trexpet:petColor";

// 저장된 색을 앱 시작 시 불러오지 않고, 항상 DEFAULT_PET_COLOR로 시작한다.
// (창 간 실시간 동기화를 위해 변경 시 저장은 계속하지만, 재시작 시 복원하지는 않음)
function writeStoredPetColor(color: string) {
  try {
    window.localStorage.setItem(PET_COLOR_STORAGE_KEY, color);
  } catch {
    // localStorage 접근 불가 환경에서는 조용히 무시
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  const expanded = normalized.length === 3
    ? normalized.split("").map((c) => c + c).join("")
    : normalized;
  const value = parseInt(expanded, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

const CHROMA_KEY_COLOR = hexToRgb(CHROMA_KEY_HEX);

// (스프라이트 경로 + 목표 색상) 조합별로 치환 결과를 캐싱해서,
// 같은 조합에 대해 canvas 연산을 다시 하지 않도록 한다.
const recolorCache = new Map<string, Promise<string>>();

// 스프라이트 이미지의 크로마키(CHROMA_KEY_HEX) 픽셀만 targetColor로 치환한
// data URL을 반환한다. 그 외 픽셀(투명 포함)은 그대로 유지된다.
function recolorSprite(imageSrc: string, targetColor: string): Promise<string> {
  const cacheKey = `${imageSrc}|${targetColor}`;
  const cached = recolorCache.get(cacheKey);
  if (cached) return cached;

  const normalizedTarget = targetColor.trim().toLowerCase();
  if (normalizedTarget === CHROMA_KEY_HEX.toLowerCase()) {
    const identity = Promise.resolve(imageSrc);
    recolorCache.set(cacheKey, identity);
    return identity;
  }

  const promise = new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        reject(new Error("canvas 2d context를 가져올 수 없습니다"));
        return;
      }

      ctx.drawImage(image, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const { data } = imageData;
      const { r: targetR, g: targetG, b: targetB } = hexToRgb(targetColor);

      for (let i = 0; i < data.length; i += 4) {
        if (
          data[i] === CHROMA_KEY_COLOR.r
          && data[i + 1] === CHROMA_KEY_COLOR.g
          && data[i + 2] === CHROMA_KEY_COLOR.b
        ) {
          data[i] = targetR;
          data[i + 1] = targetG;
          data[i + 2] = targetB;
        }
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL());
    };
    image.onerror = () => reject(new Error(`이미지를 불러오지 못했습니다: ${imageSrc}`));
    image.src = imageSrc;
  });

  promise.catch(() => recolorCache.delete(cacheKey));
  recolorCache.set(cacheKey, promise);
  return promise;
}

declare global {
  interface Window {
    electronAPI: {
      startDrag(direction: 1 | -1, cursorX: number, cursorY: number): unknown;
      resizePet(width: number, height: number): unknown;
      // 💡 메인 프로세스 메서드가 deltaX, deltaY를 받도록 하거나, 
      // 기존 매개변수 구조를 유지하되 내부 계산을 안정화합니다.
      movePet: (bx: number, by: number, ax: number, ay: number) => void;
      autoMove: (deltaX: number) => void;
      onAutoBoundary: (callback: () => void) => () => void;
      openEmotionMenu: () => void;
      openSettings: () => void;
      selectEmotion: (emotion: string) => void;
      closeEmotionMenu: (reason?: "cancel") => void;
      closeSettings: () => void;
      setPetScale: (scale: number) => void;
      setPettingMode: (enabled: boolean) => void;
      quitApp: () => void;
      onPetScaleChanged: (callback: (scale: number) => void) => () => void;
      onEmotionSelected: (callback: (emotion: string) => void) => () => void;
      onEmotionMenuClosed: (callback: (reason?: "cancel") => void) => () => void;
    };
  }
}

function SettingsWindow() {
  const initialScale = Number(new URLSearchParams(window.location.search).get("scale")) || 1;
  const [scale, setScale] = useState(initialScale);
  const [petColor, setPetColor] = useState<string>(DEFAULT_PET_COLOR);

  const updateScale = (value: string) => {
    const nextScale = Number(value);
    setScale(nextScale);
    window.electronAPI.setPetScale(nextScale);
  };

  const updatePetColor = (color: string) => {
    setPetColor(color);
    writeStoredPetColor(color);
  };

  return (
    <main className="settings-window" onContextMenu={(event) => event.preventDefault()}>
      <div className="settings-titlebar">
        <h1>공룡 설정</h1>
        <button type="button" className="settings-close" onClick={() => window.electronAPI.closeSettings()} aria-label="닫기">
          ×
        </button>
      </div>
      <label className="scale-setting">
        <span>공룡 크기</span>
        <output>{Math.round(scale * 100)}%</output>
        <input
          type="range"
          min="0.5"
          max="2"
          step="0.1"
          value={scale}
          onChange={(event) => updateScale(event.target.value)}
        />
      </label>
      <label className="color-setting">
        <span>공룡 색깔</span>
        <input
          type="color"
          value={petColor}
          onChange={(event) => updatePetColor(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="quit-setting"
        onClick={() => window.electronAPI.quitApp()}
      >
        앱 종료
      </button>
    </main>
  );
}

function EmotionMenu() {
  const selectEmotion = (emotion: string) => {
    window.electronAPI.selectEmotion(emotion);
  };

  return (
    <div
      className="emotion-overlay"
      onClick={() => window.electronAPI.closeEmotionMenu()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="emotion-menu" onClick={(e) => e.stopPropagation()}>
        {emotions.map((emotion, index) => {
          const angle = (index / emotions.length) * Math.PI * 2 - Math.PI / 2;
          const radius = 132;
          const x = 200 + Math.cos(angle) * radius;
          const y = 200 + Math.sin(angle) * radius;

          return (
            <button
              key={emotion.value}
              className="emotion-option"
              style={{ left: x, top: y }}
              onClick={() => selectEmotion(emotion.value)}
              aria-label={emotion.ariaLabel}
            >
              {emotion.label}
            </button>
          );
        })}
        <button
          type="button"
          className="emotion-center"
          aria-label="표현 안 함"
          onClick={(e) => {
            e.stopPropagation();
            window.electronAPI.closeEmotionMenu("cancel");
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

function Pet() {
  const [isHolding, setIsHolding] = useState(false);
  const [isEmotionMenuOpen, setIsEmotionMenuOpen] = useState(false);
  const [isWakingUp, setIsWakingUp] = useState(false);
  const [autoState, setAutoState] = useState<AutoState>("idle");
  const [direction, setDirection] = useState<1 | -1>(1);
  const [walkFrame, setWalkFrame] = useState(0);
  const [fastRunFrame, setFastRunFrame] = useState(0);
  const [sleepFrame, setSleepFrame] = useState(0);
  const [eatingFrame, setEatingFrame] = useState(0);
  const [workFrame, setWorkFrame] = useState(0);
  const [roarFrame, setRoarFrame] = useState(0);
  const [isPettingHeld, setIsPettingHeld] = useState(false);
  const [pettingFrame, setPettingFrame] = useState(1);
  const [petScale, setPetScale] = useState(1);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [petColor, setPetColor] = useState<string>(DEFAULT_PET_COLOR);
  const [recoloredSprite, setRecoloredSprite] = useState<string | undefined>(undefined);
  const recolorRequestIdRef = useRef(0);
  const positionRef = useRef({ x: -1, y: -1 });
  const autoStateRef = useRef<AutoState>("idle");
  const isHoldingRef = useRef(false);
  const wasSleepingBeforeDragRef = useRef(false);
  const wasWorkingBeforeDragRef = useRef(false);
  const menuOpenedFromSleepRef = useRef(false);
  const menuOpenedFromWorkRef = useRef(false);
  const emotionSelectedRef = useRef(false);
  const sleepClickTimesRef = useRef<number[]>([]);
  const pettingMotionIndexRef = useRef(0);
  const lastPettingMoveRef = useRef(0);
  const pettingStopTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    autoStateRef.current = autoState;
  }, [autoState]);

  useEffect(() => {
    writeStoredPetColor(petColor);
  }, [petColor]);

  useEffect(() => {
    // 우클릭 감정 메뉴는 별도 창(별도 렌더러)이라 React state를 공유하지
    // 않으므로, 같은 origin에서 공유되는 localStorage의 storage 이벤트로
    // 색상 변경을 실시간으로 전달받는다.
    const onStorage = (event: StorageEvent) => {
      if (event.key === PET_COLOR_STORAGE_KEY && event.newValue) {
        setPetColor(event.newValue);
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    window.electronAPI.setPettingMode(autoState === "petting");
  }, [autoState]);

  useEffect(() => {
    const root = document.documentElement;
    const isPetting = autoState === "petting";
    const cursorFile = isPettingHeld ? "hand2.png" : "hand1.png";
    root.classList.toggle("petting-cursor", isPetting);
    root.classList.toggle("petting-held", isPetting && isPettingHeld);
    root.classList.toggle("petting-held-alt", isPetting && isPettingHeld);
    const setCursor = (cursor: string) => {
      root.style.cursor = cursor;
      document.body.style.cursor = cursor;
      document.getElementById("root")?.style.setProperty("cursor", cursor);
    };
    setCursor(isPetting ? "pointer" : "");

    let cancelled = false;
    if (isPetting) {
      const image = new Image();
      image.onload = () => {
        if (cancelled) return;

        const cursorScale = petScale * 0.15;
        const width = Math.max(1, Math.round(image.naturalWidth * cursorScale));
        const height = Math.max(1, Math.round(image.naturalHeight * cursorScale));
        const hotspot = cursorHotspots[cursorFile as keyof typeof cursorHotspots];
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d")?.drawImage(image, 0, 0, width, height);
        setCursor(`url("${canvas.toDataURL("image/png")}") ${Math.round(hotspot.x * cursorScale)} ${Math.round(hotspot.y * cursorScale)}, pointer`);
      };
      image.src = `${import.meta.env.BASE_URL}pet/${cursorFile}`;
    }

    return () => {
      cancelled = true;
      root.classList.remove("petting-cursor", "petting-held", "petting-held-alt");
      root.style.cursor = "";
      document.body.style.cursor = "";
      document.getElementById("root")?.style.removeProperty("cursor");
    };
  }, [autoState, isPettingHeld, petScale]);

  const onPetMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (autoState === "fastrun") {
      e.preventDefault();
      return;
    }

    if (autoState === "eating") {
      e.preventDefault();
      return;
    }

    if (autoState === "petting" && e.button === 0) {
      e.preventDefault();
      setIsPettingHeld(true);
      return;
    }

    if (e.button === 2) {
      e.preventDefault();
      if (autoState === "sleep" || autoState === "roar") return;

      menuOpenedFromSleepRef.current = false;
      menuOpenedFromWorkRef.current = autoState === "work";
      setIsEmotionMenuOpen(true);
      setAutoState("idle");
      window.electronAPI.openEmotionMenu();
      return;
    }

    if (e.button !== 0) return;

    e.preventDefault();
    if (autoState === "sleep") {
      const now = Date.now();
      sleepClickTimesRef.current = [...sleepClickTimesRef.current.filter((time) => now - time <= 1000), now];

      if (sleepClickTimesRef.current.length >= 3) {
        sleepClickTimesRef.current = [];
        setIsWakingUp(true);
      }
      return;
    }

    wasSleepingBeforeDragRef.current = false;
    wasWorkingBeforeDragRef.current = autoState === "work";
    // 💡 시작 좌표 저장
    positionRef.current = { x: e.screenX, y: e.screenY };
    isHoldingRef.current = true;
    setIsHolding(true);
    setAutoState("idle");

    window.electronAPI.startDrag(direction, e.screenX, e.screenY);
  };

  const onPetMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (autoState !== "petting" || e.buttons !== 0) return;

    const now = Date.now();
    if (now - lastPettingMoveRef.current < 150) return;
    lastPettingMoveRef.current = now;

    const nextFrame = pettingMotionIndexRef.current;
    pettingMotionIndexRef.current = (nextFrame + 1) % 3;
    setPettingFrame(nextFrame);
    if (pettingStopTimerRef.current !== undefined) {
      window.clearTimeout(pettingStopTimerRef.current);
    }
    pettingStopTimerRef.current = window.setTimeout(() => {
      pettingMotionIndexRef.current = 1;
      setPettingFrame(1);
    }, 450);
  };

  useEffect(() => {
    if (!isHolding) return;

    const onMove = (e: MouseEvent) => {
      const { x, y } = positionRef.current;
      if (x === -1 || y === -1) return;

      // 💡 현재 마우스 위치와 이전 위치의 차이를 계산하기 전에 메인에 전달
      window.electronAPI.movePet(x, y, e.screenX, e.screenY);
    };

    const onUp = () => {
      isHoldingRef.current = false;
      setIsHolding(false);
      setAutoState(
        wasSleepingBeforeDragRef.current
          ? "sleep"
          : wasWorkingBeforeDragRef.current
            ? "work"
            : "idle",
      );
      wasSleepingBeforeDragRef.current = false;
      wasWorkingBeforeDragRef.current = false;
      positionRef.current = { x: -1, y: -1 }; // 좌표 초기화
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isHolding]);

  useEffect(() => {
    if (autoState !== "petting") return;

    const onMouseUp = () => {
      setIsPettingHeld(false);
      setPettingFrame(1);
    };

    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, [autoState]);

  useEffect(() => {
    return () => {
      if (pettingStopTimerRef.current !== undefined) {
        window.clearTimeout(pettingStopTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const removeBoundaryListener = window.electronAPI.onAutoBoundary(() => {
      if (!isHoldingRef.current && !isEmotionMenuOpen) {
        setDirection((currentDirection) => currentDirection === 1 ? -1 : 1);
      }
    });

    return removeBoundaryListener;
  }, [isEmotionMenuOpen]);

  useEffect(() => {
    return window.electronAPI.onPetScaleChanged(setPetScale);
  }, []);

  useEffect(() => {
    const removeSelectedListener = window.electronAPI.onEmotionSelected((emotion) => {
      if (autoStateRef.current === "fastrun") return;

      emotionSelectedRef.current = true;
      setIsEmotionMenuOpen(false);
      setIsHolding(false);
      setIsPettingHeld(false);
      if (emotion === "feed") {
        setEatingFrame(0);
        setAutoState("eating");
      } else if (emotion === "work") {
        setAutoState("work");
      } else if (emotion === "love") {
        pettingMotionIndexRef.current = 0;
        setPettingFrame(1);
        setAutoState("petting");
      } else {
        setAutoState("idle");
      }
      menuOpenedFromSleepRef.current = false;
      menuOpenedFromWorkRef.current = false;
    });
    const removeClosedListener = window.electronAPI.onEmotionMenuClosed(() => {
      if (emotionSelectedRef.current) {
        emotionSelectedRef.current = false;
        return;
      }

      setIsEmotionMenuOpen(false);
      if (autoStateRef.current === "fastrun") return;
      setAutoState("idle");
      menuOpenedFromSleepRef.current = false;
      menuOpenedFromWorkRef.current = false;
    });

    return () => {
      removeSelectedListener();
      removeClosedListener();
    };
  }, []);

  useEffect(() => {
    if (isHolding || isHoldingRef.current || isEmotionMenuOpen || autoState === "sleep" || autoState === "eating" || autoState === "work" || autoState === "roar" || autoState === "petting") return;

    const duration = autoState === "idle"
      ? 1000 + Math.random() * 2000
      : 2000 + Math.random() * 3000;
    const timeout = window.setTimeout(() => {
      if (!isHoldingRef.current) {
        setAutoState((currentState) => {
          if (currentState === "idle") {
            setDirection(Math.random() < 0.5 ? -1 : 1);
            const nextState = Math.random();
            if (nextState < 0.12) {
              setRoarFrame(0);
              return "roar";
            }
            if (nextState < 0.27) return "sleep";
            if (nextState < 0.35) return "idle";
            return "walk";
          }
          return "idle";
        });
      }
    }, duration);

    return () => window.clearTimeout(timeout);
  }, [autoState, isHolding, isEmotionMenuOpen]);

  useEffect(() => {
    if (autoState !== "walk" || isHolding || isEmotionMenuOpen) return;

    const fastRunCheck = window.setInterval(() => {
      if (Math.random() < 0.02 && !isHoldingRef.current) {
        setDirection(Math.random() < 0.5 ? -1 : 1);
        setFastRunFrame(0);
        setAutoState("fastrun");
      }
    }, 170);

    return () => window.clearInterval(fastRunCheck);
  }, [autoState, isHolding, isEmotionMenuOpen]);

  useEffect(() => {
    if (autoState !== "fastrun") return;

    const fastRunTimer = window.setTimeout(() => {
      setAutoState((currentState) => currentState === "fastrun" ? "walk" : currentState);
    }, 5000);

    return () => window.clearTimeout(fastRunTimer);
  }, [autoState]);

  useEffect(() => {
    if ((autoState !== "walk" && autoState !== "fastrun") || isHolding || isEmotionMenuOpen) return;

    let animationFrame = 0;
    let cancelled = false;
    let previousTime = performance.now();
    const walkSpeed = autoState === "fastrun" ? 360 : 90;

    const move = (currentTime: number) => {
      if (cancelled || isHoldingRef.current) return;

      const elapsed = currentTime - previousTime;
      previousTime = currentTime;
      window.electronAPI.autoMove(direction * walkSpeed * elapsed / 1000);

      if (!cancelled) {
        animationFrame = requestAnimationFrame(move);
      }
    };

    animationFrame = requestAnimationFrame(move);
    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrame);
    };
  }, [autoState, direction, isHolding, isEmotionMenuOpen]);

  useEffect(() => {
    if ((autoState !== "walk" && autoState !== "fastrun") || isHolding || isEmotionMenuOpen) {
      return;
    }

    const frameTimer = window.setInterval(() => {
      setWalkFrame((currentFrame) => (currentFrame + 1) % 2);
    }, autoState === "fastrun" ? 70 : 170);

    return () => window.clearInterval(frameTimer);
  }, [autoState, isHolding, isEmotionMenuOpen]);

  useEffect(() => {
    if (autoState !== "fastrun" || isHolding || isEmotionMenuOpen) return;

    const frameTimer = window.setInterval(() => {
      setFastRunFrame((currentFrame) => (currentFrame + 1) % 2);
    }, 120);

    return () => window.clearInterval(frameTimer);
  }, [autoState, isHolding, isEmotionMenuOpen]);

  useEffect(() => {
    if (autoState !== "sleep" || isHolding || isEmotionMenuOpen || isWakingUp) {
      return;
    }

    const frameTimer = window.setInterval(() => {
      setSleepFrame((currentFrame) => (currentFrame + 1) % 4);
    }, 800);

    return () => window.clearInterval(frameTimer);
  }, [autoState, isHolding, isEmotionMenuOpen, isWakingUp]);

  useEffect(() => {
    if (autoState !== "eating" || isHolding || isEmotionMenuOpen) return;

    let nextFrame = 0;
    const frameTimer = window.setInterval(() => {
      nextFrame += 1;

      if (nextFrame >= 3) {
        window.clearInterval(frameTimer);
        setAutoState("idle");
        return;
      }

      setEatingFrame(nextFrame);
    }, 450);

    return () => window.clearInterval(frameTimer);
  }, [autoState, isHolding, isEmotionMenuOpen]);

  useEffect(() => {
    if (autoState !== "roar" || isHolding || isEmotionMenuOpen) return;

    let nextFrame = 0;
    const frameTimer = window.setInterval(() => {
      nextFrame += 1;

      if (nextFrame >= 4) {
        window.clearInterval(frameTimer);
        setAutoState("idle");
        return;
      }

      setRoarFrame(nextFrame);
    }, 250);

    return () => window.clearInterval(frameTimer);
  }, [autoState, isHolding, isEmotionMenuOpen]);

  useEffect(() => {
    if (autoState !== "work" || isHolding || isEmotionMenuOpen) return;

    const frameTimer = window.setInterval(() => {
      setWorkFrame((currentFrame) => (currentFrame + 1) % 2);
    }, 350);

    return () => window.clearInterval(frameTimer);
  }, [autoState, isHolding, isEmotionMenuOpen]);

  useEffect(() => {
    if (autoState !== "sleep") {
      sleepClickTimesRef.current = [];
      return;
    }

    const wakeupTimer = window.setTimeout(() => {
      setIsWakingUp(true);
    }, 10000 + Math.random() * 50000);

    return () => window.clearTimeout(wakeupTimer);
  }, [autoState]);

  useEffect(() => {
    if (!isWakingUp) return;

    const wakeupTimer = window.setTimeout(() => {
      setIsWakingUp(false);
      setAutoState("idle");
    }, 700);

    return () => window.clearTimeout(wakeupTimer);
  }, [isWakingUp]);

  const sprite = isHolding
    ? `${import.meta.env.BASE_URL}pet/hold.png`
    : isWakingUp
      ? `${import.meta.env.BASE_URL}pet/wakeup.png`
    : autoState === "sleep"
      ? `${import.meta.env.BASE_URL}pet/sleep${sleepFrame + 1}.png`
      : autoState === "eating"
      ? `${import.meta.env.BASE_URL}pet/eat${eatingFrame + 1}.png`
      : autoState === "roar"
      ? `${import.meta.env.BASE_URL}pet/roar${roarFrame + 1}.png`
      : autoState === "work"
      ? `${import.meta.env.BASE_URL}pet/neptop${workFrame + 1}.png`
      : autoState === "petting"
      ? `${import.meta.env.BASE_URL}pet/${isPettingHeld ? "petting4.png" : pettingFrame === 0 ? "petting1.png" : pettingFrame === 1 ? "petting2.png" : "petting3.png"}`
      : autoState === "fastrun"
      ? `${import.meta.env.BASE_URL}pet/fastrun${fastRunFrame + 1}.png`
      : autoState === "walk"
      ? `${import.meta.env.BASE_URL}pet/run${walkFrame + 1}.png`
      : `${import.meta.env.BASE_URL}pet/idle.png`;

  useEffect(() => {
    const requestId = ++recolorRequestIdRef.current;

    recolorSprite(sprite, petColor).then((dataUrl) => {
      // 색/프레임이 그 사이 또 바뀌어 더 최신 요청이 나갔다면 이 결과는 버린다
      // (늦게 끝난 이전 요청이 최신 프레임을 덮어써서 깜빡이는 것을 방지).
      if (recolorRequestIdRef.current !== requestId) return;
      setRecoloredSprite(dataUrl);
    });
  }, [sprite, petColor]);

  return (
    // 💡 .pet div 자체에 grab 커서가 먹히도록 설정 (CSS에서 세팅)
    <div
      className="pet"
      onMouseDown={onPetMouseDown}
      onMouseMove={onPetMouseMove}
      onContextMenu={(e) => e.preventDefault()}
    >
      <img
        // 치환이 끝나기 전(또는 아직 한 번도 끝난 적 없을 때)에는 원본 sprite를
        // 그대로 보여줘서 깜빡임 없이 이전 프레임 → 원본 → 치환본 순으로 자연스럽게 이어지게 한다.
        src={recoloredSprite ?? sprite}
        alt="pet"
        draggable={false}
        onLoad={(event) => {
          const image = event.currentTarget;
          setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
          window.electronAPI.resizePet(image.naturalWidth, image.naturalHeight);
        }}
        style={{
          width: imageSize.width ? imageSize.width * petScale : undefined,
          height: imageSize.height ? imageSize.height * petScale : undefined,
          transform: `scaleX(${direction})`,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

function App() {
  if (isEmotionMenu) return <EmotionMenu />;
  if (isSettingsWindow) return <SettingsWindow />;
  return <Pet />;
}

export default App;
