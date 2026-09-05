import { useState, useEffect, useRef } from "react";

declare global {
  interface Window {
    electronAPI: {
      startDrag(): unknown;
      // 💡 메인 프로세스 메서드가 deltaX, deltaY를 받도록 하거나, 
      // 기존 매개변수 구조를 유지하되 내부 계산을 안정화합니다.
      movePet: (bx: number, by: number, ax: number, ay: number) => void;
    };
  }
}

function App() {
  const [isHolding, setIsHolding] = useState(false);
  const positionRef = useRef({ x: -1, y: -1 });

  const onPetMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    // 💡 시작 좌표 저장
    positionRef.current = { x: e.screenX, y: e.screenY };
    setIsHolding(true);

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
      setIsHolding(false);
      positionRef.current = { x: -1, y: -1 }; // 좌표 초기화
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isHolding]);

  return (
    // 💡 .pet div 자체에 grab 커서가 먹히도록 설정 (CSS에서 세팅)
    <div className="pet" onMouseDown={onPetMouseDown}>
      <img
        src={isHolding ? "/pet/hold.png" : "/pet/idle.png"}
        alt="pet"
        draggable={false}
        style={{ pointerEvents: "none" }} // 이미지가 마우스 이벤트를 방해하지 않게 차단
      />
    </div>
  );
}

export default App;
