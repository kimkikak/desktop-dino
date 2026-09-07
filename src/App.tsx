import { useState, useEffect, useRef } from "react";

type AutoState = "idle" | "walk";
const isEmotionMenu = new URLSearchParams(window.location.search).get("window") === "emotion-menu";
const emotions = ["😊", "😢", "😡", "❤️", "💤"];

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
      closeEmotionMenu: () => void;
      onEmotionSelected: (callback: (emotion: string) => void) => () => void;
      onEmotionMenuClosed: (callback: () => void) => () => void;
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
              key={emotion}
              className="emotion-option"
              style={{ left: x, top: y }}
              onClick={() => selectEmotion(emotion)}
              aria-label={`감정 ${emotion}`}
            >
              {emotion}
            </button>
          );
        })}
        <div className="emotion-center" aria-hidden="true">♡</div>
      </div>
    </div>
  );
}

function Pet() {
  const [isHolding, setIsHolding] = useState(false);
  const [isEmotionMenuOpen, setIsEmotionMenuOpen] = useState(false);
  const [autoState, setAutoState] = useState<AutoState>("idle");
  const [direction, setDirection] = useState<1 | -1>(1);
  const [walkFrame, setWalkFrame] = useState(0);
  const positionRef = useRef({ x: -1, y: -1 });
  const isHoldingRef = useRef(false);

  const onPetMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button === 2) {
      e.preventDefault();
      setIsEmotionMenuOpen(true);
      setAutoState("idle");
      window.electronAPI.openEmotionMenu();
      return;
    }

    if (e.button !== 0) return;

    e.preventDefault();
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
      setAutoState("idle");
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
    const removeSelectedListener = window.electronAPI.onEmotionSelected(() => {
      setIsEmotionMenuOpen(false);
      setIsHolding(false);
      setAutoState("idle");
    });
    const removeClosedListener = window.electronAPI.onEmotionMenuClosed(() => {
      setIsEmotionMenuOpen(false);
      setAutoState("idle");
    });

    return () => {
      removeSelectedListener();
      removeClosedListener();
    };
  }, []);

  useEffect(() => {
    if (isHolding || isHoldingRef.current || isEmotionMenuOpen) return;

    const duration = autoState === "idle"
      ? 1000 + Math.random() * 2000
      : 2000 + Math.random() * 3000;
    const timeout = window.setTimeout(() => {
      if (!isHoldingRef.current) {
        setAutoState((currentState) => {
          if (currentState === "idle") {
            setDirection(Math.random() < 0.5 ? -1 : 1);
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

  const sprite = isHolding
    ? "/pet/hold.png"
    : autoState === "walk"
      ? `/pet/run${walkFrame + 1}.png`
      : "/pet/idle.png";

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
