import { useState, useEffect, useRef } from "react";

type AutoState = "idle" | "walk" | "fastrun" | "sleep" | "eating" | "work" | "roar";
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
      startDrag(direction: 1 | -1, cursorX: number, cursorY: number): unknown;
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
  const [fastRunFrame, setFastRunFrame] = useState(0);
  const [sleepFrame, setSleepFrame] = useState(0);
  const [eatingFrame, setEatingFrame] = useState(0);
  const [workFrame, setWorkFrame] = useState(0);
  const [roarFrame, setRoarFrame] = useState(0);
  const positionRef = useRef({ x: -1, y: -1 });
  const autoStateRef = useRef<AutoState>("idle");
  const isHoldingRef = useRef(false);
  const wasSleepingBeforeDragRef = useRef(false);
  const wasWorkingBeforeDragRef = useRef(false);
  const menuOpenedFromSleepRef = useRef(false);
  const menuOpenedFromWorkRef = useRef(false);
  const emotionSelectedRef = useRef(false);
  const sleepClickTimesRef = useRef<number[]>([]);

  useEffect(() => {
    autoStateRef.current = autoState;
  }, [autoState]);

  const onPetMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (autoState === "fastrun") {
      e.preventDefault();
      return;
    }

    if (autoState === "eating") {
      e.preventDefault();
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
      if (autoStateRef.current === "fastrun") return;

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
    if (isHolding || isHoldingRef.current || isEmotionMenuOpen || autoState === "sleep" || autoState === "eating" || autoState === "work" || autoState === "roar") return;

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
    let previousTime = performance.now();
    const walkSpeed = autoState === "fastrun" ? 360 : 90;

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
      : autoState === "fastrun"
      ? `${import.meta.env.BASE_URL}pet/fastrun${fastRunFrame + 1}.png`
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
