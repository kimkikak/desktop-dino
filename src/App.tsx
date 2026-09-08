import { useState, useEffect, useRef } from "react";

type AutoState = "idle" | "walk" | "sleep" | "eating" | "work";
const isEmotionMenu = new URLSearchParams(window.location.search).get("window") === "emotion-menu";
const emotions = [
  { value: "feed", label: "🍖", ariaLabel: "밥주기" },
  { value: "work", label: "💻", ariaLabel: "작업" },
  { value: "angry", label: "😡", ariaLabel: "감정 😡" },
  { value: "love", label: "❤️", ariaLabel: "❤️" },
];

declare global {
  interface Window {
    electronAPI: {
      startDrag(): unknown;
      // 💡 메인 프로세스 메서드가 deltaX, deltaY를 받도록 하거나, 
      // 기존 매개변수 구조를 유지하되 내부 계산을 안정화합니다.
      movePet: (bx: number, by: number, ax: number, ay: number) => void;
      autoMove: (deltaX: number) => void;
      onAutoBoundary: (callback: () => void) => () => void;
      openEmotionMenu: () => void;
      selectEmotion: (emotion: string) => void;
      closeEmotionMenu: (reason?: "cancel") => void;
      onEmotionSelected: (callback: (emotion: string) => void) => () => void;
      onEmotionMenuClosed: (callback: (reason?: "cancel") => void) => () => void;
    };
  }
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
  const [sleepFrame, setSleepFrame] = useState(0);
  const [eatingFrame, setEatingFrame] = useState(0);
  const [workFrame, setWorkFrame] = useState(0);
  const positionRef = useRef({ x: -1, y: -1 });
  const isHoldingRef = useRef(false);
  const wasSleepingBeforeDragRef = useRef(false);
  const wasWorkingBeforeDragRef = useRef(false);
  const menuOpenedFromSleepRef = useRef(false);
  const menuOpenedFromWorkRef = useRef(false);
  const emotionSelectedRef = useRef(false);
  const sleepClickTimesRef = useRef<number[]>([]);

  const onPetMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (autoState === "eating") {
      e.preventDefault();
      return;
    }

    if (e.button === 2) {
      e.preventDefault();
      if (autoState === "sleep") return;

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

    window.electronAPI.startDrag();
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
    const removeBoundaryListener = window.electronAPI.onAutoBoundary(() => {
      if (!isHoldingRef.current && !isEmotionMenuOpen) {
        setDirection((currentDirection) => currentDirection === 1 ? -1 : 1);
      }
    });

    return removeBoundaryListener;
  }, [isEmotionMenuOpen]);

  useEffect(() => {
    const removeSelectedListener = window.electronAPI.onEmotionSelected((emotion) => {
      emotionSelectedRef.current = true;
      setIsEmotionMenuOpen(false);
      setIsHolding(false);
      if (emotion === "feed") {
        setEatingFrame(0);
        setAutoState("eating");
      } else if (emotion === "work") {
        setAutoState("work");
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
    if (isHolding || isHoldingRef.current || isEmotionMenuOpen || autoState === "sleep" || autoState === "eating" || autoState === "work") return;

    const duration = autoState === "idle"
      ? 1000 + Math.random() * 2000
      : 2000 + Math.random() * 3000;
    const timeout = window.setTimeout(() => {
      if (!isHoldingRef.current) {
        setAutoState((currentState) => {
          if (currentState === "idle") {
            setDirection(Math.random() < 0.5 ? -1 : 1);
            return Math.random() < 0.15 ? "sleep" : "walk";
          }
          return "idle";
        });
      }
    }, duration);

    return () => window.clearTimeout(timeout);
  }, [autoState, isHolding, isEmotionMenuOpen]);

  useEffect(() => {
    if (autoState !== "walk" || isHolding || isEmotionMenuOpen) return;

    let animationFrame = 0;
    let previousTime = performance.now();
    const walkSpeed = 90;

    const move = (currentTime: number) => {
      if (!isHoldingRef.current) {
        const elapsed = currentTime - previousTime;
        previousTime = currentTime;
        window.electronAPI.autoMove(direction * walkSpeed * elapsed / 1000);
        animationFrame = requestAnimationFrame(move);
      }
    };

    animationFrame = requestAnimationFrame(move);
    return () => cancelAnimationFrame(animationFrame);
  }, [autoState, direction, isHolding, isEmotionMenuOpen]);

  useEffect(() => {
    if (autoState !== "walk" || isHolding || isEmotionMenuOpen) {
      return;
    }

    const frameTimer = window.setInterval(() => {
      setWalkFrame((currentFrame) => (currentFrame + 1) % 2);
    }, 170);

    return () => window.clearInterval(frameTimer);
  }, [autoState, isHolding, isEmotionMenuOpen]);

  useEffect(() => {
    if (autoState !== "sleep" || isHolding || isEmotionMenuOpen || isWakingUp) {
      return;
    }

    const frameTimer = window.setInterval(() => {
      setSleepFrame((currentFrame) => (currentFrame + 1) % 3);
    }, 350);

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
    }, 5000 + Math.random() * 25000);

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
      : autoState === "work"
      ? `${import.meta.env.BASE_URL}pet/neptop${workFrame + 1}.png`
      : autoState === "walk"
      ? `${import.meta.env.BASE_URL}pet/run${walkFrame + 1}.png`
      : `${import.meta.env.BASE_URL}pet/idle.png`;

  return (
    // 💡 .pet div 자체에 grab 커서가 먹히도록 설정 (CSS에서 세팅)
    <div className="pet" onMouseDown={onPetMouseDown} onContextMenu={(e) => e.preventDefault()}>
      <img
        src={sprite}
        alt="pet"
        draggable={false}
        style={{ transform: `scaleX(${direction})`, pointerEvents: "none" }}
      />
    </div>
  );
}

function App() {
  return isEmotionMenu ? <EmotionMenu /> : <Pet />;
}

export default App;
