import { useState, useEffect, useRef } from "react";

type AutoState = "idle" | "walk" | "fastrun" | "sleep" | "eating" | "work" | "roar" | "petting";
const isEmotionMenu = new URLSearchParams(window.location.search).get("window") === "emotion-menu";
const isSettingsWindow = new URLSearchParams(window.location.search).get("window") === "settings";
const isWardrobeWindow = new URLSearchParams(window.location.search).get("window") === "wardrobe";
const cursorHotspots = {
  "hand1.png": { x: 130, y: 65 },
  "hand2.png": { x: 125, y: 58 },
} as const;
const emotions = [
  { value: "feed", label: "🍖", ariaLabel: "밥주기" },
  { value: "work", label: "💻", ariaLabel: "작업" },
  { value: "love", label: "❤️", ariaLabel: "❤️" },
  { value: "wardrobe", label: "👕", ariaLabel: "옷장" },
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

// 옷장에서 착용한 아이템 (슬롯별 아이템 id). 옷장 창과 공룡 창은 별도 렌더러라
// 색깔과 같은 방식으로 localStorage + storage 이벤트로 주고받는다.
// 색깔과 마찬가지로 재시작 시 복원하지 않고 항상 아무것도 안 입은 상태로 시작한다.
type ItemSlot = "head" | "back";
type EquippedItems = Record<ItemSlot, string | null>;
const DEFAULT_EQUIPPED_ITEMS: EquippedItems = { head: null, back: null };
const EQUIPPED_ITEMS_STORAGE_KEY = "trexpet:equippedItems";

function parseEquippedItems(raw: string | null): EquippedItems {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      head: typeof parsed?.head === "string" ? parsed.head : null,
      back: typeof parsed?.back === "string" ? parsed.back : null,
    };
  } catch {
    return DEFAULT_EQUIPPED_ITEMS;
  }
}

function readStoredEquippedItems(): EquippedItems {
  try {
    return parseEquippedItems(window.localStorage.getItem(EQUIPPED_ITEMS_STORAGE_KEY));
  } catch {
    return DEFAULT_EQUIPPED_ITEMS;
  }
}

function writeStoredEquippedItems(items: EquippedItems) {
  try {
    window.localStorage.setItem(EQUIPPED_ITEMS_STORAGE_KEY, JSON.stringify(items));
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

// 아이템(모자 등) 앵커: 스프라이트의 머리 위에 이 색의 마커가 찍혀 있고,
// 그 좌표를 아이템을 붙일 기준점으로 쓴다. 마커 픽셀은 몸통 크로마키 색으로 덮어서
// 이후 몸통 색 치환 때 함께 칠해지게 한다 (마커가 몸통 안쪽에 찍혀 있어 투명하게 지우면 구멍이 남음).
const ANCHOR_MARKER_HEX = "#FF8000";
// 모자 여백(창 위쪽) 계산을 위해 미리 앵커를 읽어둘 공룡 스프라이트 전체 목록
const PET_SPRITE_SRCS = [
  "idle", "hold", "wakeup",
  "sleep1", "sleep2", "sleep3", "sleep4",
  "eat1", "eat2", "eat3",
  "roar1", "roar2", "roar3", "roar4",
  "neptop1", "neptop2",
  "petting1", "petting2", "petting3", "petting4",
  "fastrun1", "fastrun2",
  "run1", "run2",
].map((name) => `${import.meta.env.BASE_URL}pet/${name}.png`);

// 옷장 아이템 목록. 머리 장식은 스프라이트의 앵커 마커에 붙는다.
// (등 장식은 아직 아이템/마커가 없어 옷장 UI만 있다)
const WARDROBE_SLOTS: { slot: ItemSlot; label: string }[] = [
  { slot: "head", label: "머리 장식" },
  { slot: "back", label: "등 장식" },
];
// src: 기본 이미지(옷장 썸네일에도 사용). poseSrcs: 특정 자세에서 대신 쓰는 이미지로,
// 키는 스프라이트 파일 이름에서 끝 번호를 뗀 자세 이름(roar1.png → "roar")이다.
// 머리 장식 이미지는 public/head/에 `{id}.png`, 자세별은 `{자세}-{id}.png`로 둔다.
type WardrobeItem = { id: string; slot: ItemSlot; name: string; src: string; poseSrcs?: Record<string, string> };
const headItemSrc = (fileName: string) => `${import.meta.env.BASE_URL}head/${fileName}.png`;
const WARDROBE_ITEMS: WardrobeItem[] = [
  {
    id: "1cap",
    slot: "head",
    name: "모자",
    src: headItemSrc("1cap"),
    poseSrcs: { roar: headItemSrc("roar-1cap") },
  },
];

// 스프라이트 경로에서 자세 이름을 뽑는다 (".../pet/roar3.png" → "roar")
function spritePose(spriteSrc: string): string {
  const fileName = spriteSrc.slice(spriteSrc.lastIndexOf("/") + 1);
  return fileName.replace(/\d*\.png$/, "");
}

function itemSrcForSprite(item: WardrobeItem, spriteSrc: string): string {
  return item.poseSrcs?.[spritePose(spriteSrc)] ?? item.src;
}

function findWardrobeItem(slot: ItemSlot, id: string | null) {
  return WARDROBE_ITEMS.find((item) => item.slot === slot && item.id === id) ?? null;
}

// 공룡 자세가 돌아가 있는 스프라이트는 아이템도 같이 돌린다 (시계 방향, 도 단위).
// hold.png는 idle을 시계 방향 90° 돌린 자세라 머리 위쪽이 오른쪽을 향한다.
type ItemRotation = 0 | 90;
const ITEM_ROTATION_BY_SPRITE: Record<string, ItemRotation> = {
  [`${import.meta.env.BASE_URL}pet/hold.png`]: 90,
};
function itemRotationFor(spriteSrc: string): ItemRotation {
  return ITEM_ROTATION_BY_SPRITE[spriteSrc] ?? 0;
}

type AnchorPoint = { x: number; y: number };
// markerRight: 마커 영역의 오른쪽 경계 (가장 오른쪽 픽셀 x + 1)
type MarkerResult = { src: string; anchor: AnchorPoint | null; markerRight: number; width: number; height: number };

// 스프라이트 경로 + 마커 색 조합별로 (마커 지운 data URL, 앵커 좌표, 크기)를 캐싱한다.
// findAnchor와 스프라이트 렌더링이 같은 결과를 공유해서 이미지를 한 번만 처리한다.
const markerCache = new Map<string, Promise<MarkerResult>>();

// 스프라이트에서 markerColor와 RGB가 정확히 일치하는 픽셀들을 찾아
// 그 영역의 왼쪽 위 끝(가장 왼쪽 x, 가장 위 y)을 앵커로 잡고 (1px 마커면 그 픽셀 좌표 그대로),
// 마커 픽셀들을 크로마키 색으로 덮은 data URL을 함께 반환한다.
function stripAnchorMarker(
  imageSrc: string,
  markerColor: string,
): Promise<MarkerResult> {
  const cacheKey = `${imageSrc}|${markerColor}`;
  const cached = markerCache.get(cacheKey);
  if (cached) return cached;

  const promise = new Promise<MarkerResult>((resolve, reject) => {
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
      const { r: markerR, g: markerG, b: markerB } = hexToRgb(markerColor);
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;

      for (let i = 0; i < data.length; i += 4) {
        if (
          data[i + 3] !== 0
          && data[i] === markerR
          && data[i + 1] === markerG
          && data[i + 2] === markerB
        ) {
          const pixelIndex = i / 4;
          const x = pixelIndex % canvas.width;
          const y = Math.floor(pixelIndex / canvas.width);
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          data[i] = CHROMA_KEY_COLOR.r;
          data[i + 1] = CHROMA_KEY_COLOR.g;
          data[i + 2] = CHROMA_KEY_COLOR.b;
        }
      }

      const anchor = minY === Infinity ? null : { x: minX, y: minY };
      const size = { width: canvas.width, height: canvas.height };

      if (!anchor) {
        // 마커가 없으면 원본을 그대로 쓴다 (불필요한 data URL 생성 방지)
        resolve({ src: imageSrc, anchor: null, markerRight: 0, ...size });
        return;
      }

      ctx.putImageData(imageData, 0, 0);
      resolve({ src: canvas.toDataURL(), anchor, markerRight: maxX + 1, ...size });
    };
    image.onerror = () => reject(new Error(`이미지를 불러오지 못했습니다: ${imageSrc}`));
    image.src = imageSrc;
  });

  promise.catch(() => markerCache.delete(cacheKey));
  markerCache.set(cacheKey, promise);
  return promise;
}

function findAnchor(imageSrc: string, markerColor: string): Promise<AnchorPoint | null> {
  return stripAnchorMarker(imageSrc, markerColor).then((result) => result.anchor);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`이미지를 불러오지 못했습니다: ${src}`));
    image.src = src;
  });
}

// 도트 1px이 물리 픽셀 정수 개로 딱 떨어지는 배율. petScale × devicePixelRatio가
// 정수가 아니면 최근접 이웃 확대에서 같은 5px 띠도 13칸/14칸처럼 폭이 들쭉날쭉해진다.
// main 프로세스의 renderScale()과 같은 계산이어야 창 크기와 그림 크기가 맞는다.
function snapScaleToDevicePixels(scale: number, devicePixelRatio: number): number {
  return Math.max(1, Math.round(scale * devicePixelRatio)) / devicePixelRatio;
}

// 공룡과 아이템을 서로 다른 위치/크기의 <img>로 겹치면, 배율(petScale × 화면 배율)이
// 정수가 아닐 때 두 이미지의 픽셀 경계가 따로 반올림되어 1px 미만으로 어긋난다.
// 그래서 둘 다 "위쪽 여백 + 스프라이트" 크기의 같은 캔버스 격자에 그린 뒤,
// 완전히 같은 박스에 겹쳐 그려서 픽셀 경계가 항상 일치하게 한다.
const layerCache = new Map<string, Promise<string>>();

function cachedLayer(cacheKey: string, build: () => Promise<string>): Promise<string> {
  const cached = layerCache.get(cacheKey);
  if (cached) return cached;
  const promise = build();
  promise.catch(() => layerCache.delete(cacheKey));
  layerCache.set(cacheKey, promise);
  return promise;
}

// 스프라이트 위쪽에 topInset(px), 오른쪽에 rightInset(px)만큼 투명 여백을 덧붙인 data URL
function padSprite(imageSrc: string, topInset: number, rightInset: number): Promise<string> {
  if (topInset <= 0 && rightInset <= 0) return Promise.resolve(imageSrc);
  return cachedLayer(`pad|${topInset}|${rightInset}|${imageSrc}`, () => loadImage(imageSrc).then((image) => {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth + rightInset;
    canvas.height = image.naturalHeight + topInset;
    canvas.getContext("2d")?.drawImage(image, 0, topInset);
    return canvas.toDataURL();
  }));
}

// 아이템의 "왼쪽 아래 끝"을 붙일 점. 서 있는 자세에서는 마커의 왼쪽 위 모서리이고,
// 시계 방향 90° 돌아간 자세에서는 같은 점이 마커의 오른쪽 위 모서리로 옮겨간다.
function itemAttachPoint(marker: MarkerResult & { anchor: AnchorPoint }, rotation: ItemRotation): AnchorPoint {
  return rotation === 90 ? { x: marker.markerRight, y: marker.anchor.y } : marker.anchor;
}

// 스프라이트(위쪽 여백 포함)와 같은 크기의 투명 캔버스에, 아이템의 왼쪽 아래 끝이
// attachPoint에 오도록 아이템을 (rotation만큼 시계 방향으로 돌려서) 그린 data URL.
// 90° 단위 회전 + 정수 좌표라 도트가 뭉개지지 않는다.
function composeItemLayer(
  itemSrc: string,
  attachPoint: AnchorPoint,
  rotation: ItemRotation,
  spriteWidth: number,
  spriteHeight: number,
  topInset: number,
): Promise<string> {
  const cacheKey = `item|${itemSrc}|${attachPoint.x},${attachPoint.y}|${rotation}|${spriteWidth}x${spriteHeight}|${topInset}`;
  return cachedLayer(cacheKey, () => loadImage(itemSrc).then((item) => {
    const canvas = document.createElement("canvas");
    canvas.width = spriteWidth;
    canvas.height = spriteHeight + topInset;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context를 가져올 수 없습니다");
    ctx.imageSmoothingEnabled = false;
    ctx.translate(attachPoint.x, topInset + attachPoint.y);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(item, 0, -item.naturalHeight);
    return canvas.toDataURL();
  }));
}

declare global {
  interface Window {
    electronAPI: {
      startDrag(direction: 1 | -1, cursorX: number, cursorY: number): unknown;
      resizePet(width: number, height: number, topInset?: number): unknown;
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
      closeWardrobe: () => void;
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
  const [devicePixelRatio, setDevicePixelRatio] = useState(window.devicePixelRatio || 1);
  // width/height: 스프라이트 원본 크기, inset: 화면에 그려진 이미지 위쪽에 붙어 있는 모자 여백
  const [imageSize, setImageSize] = useState({ width: 0, height: 0, inset: 0 });
  const [petColor, setPetColor] = useState<string>(DEFAULT_PET_COLOR);
  const [recoloredSprite, setRecoloredSprite] = useState<string | undefined>(undefined);
  // recoloredSprite 위쪽에 덧붙인 모자 여백(px)
  const [recoloredSpriteInset, setRecoloredSpriteInset] = useState(0);
  // 옷장에서 착용한 아이템 (옷장 창에서 localStorage로 전달됨)
  const [equippedItems, setEquippedItems] = useState<EquippedItems>(DEFAULT_EQUIPPED_ITEMS);
  // 스프라이트별 앵커 (마커가 없는 스프라이트는 null)
  const [spriteAnchors, setSpriteAnchors] = useState<(AnchorPoint | null)[]>([]);
  // 착용한 머리 장식의 이미지별(기본/자세별) 크기
  const [hatSizes, setHatSizes] = useState<{
    itemId: string;
    sizes: Record<string, { width: number; height: number }>;
  } | null>(null);
  // recoloredSprite와 짝이 되는 모자 레이어 (앵커가 없는 프레임이면 null)
  const [hatLayer, setHatLayer] = useState<string | null>(null);
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
    // 시작 시 착용 상태(기본값: 아무것도 안 입음)를 저장해서, 옷장 창이 열릴 때 현재 상태를 읽을 수 있게 한다
    writeStoredEquippedItems(equippedItems);
  }, [equippedItems]);

  useEffect(() => {
    // 우클릭 감정 메뉴는 별도 창(별도 렌더러)이라 React state를 공유하지
    // 않으므로, 같은 origin에서 공유되는 localStorage의 storage 이벤트로
    // 색상 변경을 실시간으로 전달받는다.
    const onStorage = (event: StorageEvent) => {
      if (event.key === PET_COLOR_STORAGE_KEY && event.newValue) {
        setPetColor(event.newValue);
      }
      if (event.key === EQUIPPED_ITEMS_STORAGE_KEY) {
        setEquippedItems(parseEquippedItems(event.newValue));
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
    // 모든 스프라이트의 앵커를 미리 읽어둔다 (결과는 캐시되어 렌더링 때 그대로 재사용됨)
    Promise.all(PET_SPRITE_SRCS.map((src) => findAnchor(src, ANCHOR_MARKER_HEX).catch(() => null)))
      .then(setSpriteAnchors);
  }, []);

  // 옷장에서 고른 머리 장식 (없으면 null)
  const hatItem = findWardrobeItem("head", equippedItems.head);

  useEffect(() => {
    if (!hatItem) return;
    // 기본 이미지와 자세별 이미지는 크기가 다를 수 있어 전부 읽어둔다
    const srcs = [hatItem.src, ...Object.values(hatItem.poseSrcs ?? {})];
    Promise.all(srcs.map((src) => loadImage(src))).then(
      (images) => setHatSizes({
        itemId: hatItem.id,
        sizes: Object.fromEntries(images.map((image, index) => (
          [srcs[index], { width: image.naturalWidth, height: image.naturalHeight }]
        ))),
      }),
      () => setHatSizes(null),
    );
  }, [hatItem]);

  // 아이템을 바꾼 직후 이전 아이템 크기로 계산하지 않도록, 지금 아이템의 크기를 읽은 뒤에만 모자를 씌운다
  const hatImageSizes = hatItem && hatSizes?.itemId === hatItem.id ? hatSizes.sizes : null;
  const hasHat = hatImageSizes !== null;

  // 모자가 머리 위로 가장 많이 튀어나오는 프레임 기준으로 창 위쪽에 여백을 둔다 (스프라이트 원본 픽셀 단위).
  // 프레임마다 다르게 두면 상태/프레임이 바뀔 때마다 창이 들썩이므로, 모자를 쓰고 있는 동안은 고정한다.
  // (90° 돌린 모자는 붙는 점에서 아래로 펼쳐지므로 위로 튀어나오지 않는다)
  const hatInset = hatItem && hatImageSizes
    ? Math.max(0, ...spriteAnchors.map((anchor, index) => {
      const spriteSrc = PET_SPRITE_SRCS[index];
      if (!anchor || itemRotationFor(spriteSrc) !== 0) return 0;
      const size = hatImageSizes[itemSrcForSprite(hatItem, spriteSrc)];
      return size ? size.height - anchor.y : 0;
    }))
    : 0;

  useEffect(() => {
    const requestId = ++recolorRequestIdRef.current;

    (async () => {
      // 앵커 마커를 먼저 지운 뒤(마커 없는 스프라이트는 원본 그대로) 기존과 같은 방식으로 색을 치환한다.
      const marker = await stripAnchorMarker(sprite, ANCHOR_MARKER_HEX).catch(() => null);
      const recolored = await recolorSprite(marker?.src ?? sprite, petColor);

      // 이 자세에서 쓸 모자 이미지 (roar는 roar 전용 이미지)
      const hatSrc = hatItem && hatImageSizes ? itemSrcForSprite(hatItem, sprite) : null;
      const hatSize = hatSrc ? hatImageSizes?.[hatSrc] : undefined;
      const rotation = itemRotationFor(sprite);
      const attachPoint = hatSize && marker?.anchor
        ? itemAttachPoint({ ...marker, anchor: marker.anchor }, rotation)
        : null;
      // 모자가 스프라이트 오른쪽 밖으로 나가는 만큼 오른쪽 여백을 둔다 (지금은 90° 돌린 hold만 해당).
      // 이 프레임에서만 창이 가로로 넓어진다. 좌우 반전 시 여백은 왼쪽으로 가지만,
      // main의 꼬리 스냅이 "창 폭 - 꼬리 오프셋"으로 계산하므로 그대로 맞는다.
      const hatRight = attachPoint && hatSize
        ? attachPoint.x + (rotation === 90 ? hatSize.height : hatSize.width)
        : 0;
      const rightInset = marker ? Math.max(0, hatRight - marker.width) : 0;

      // 모자와 같은 픽셀 격자를 쓰도록 모든 프레임에 모자 여백을 위쪽(과 필요하면 오른쪽)에 덧붙인다
      const padded = await padSprite(recolored, hatInset, rightInset);
      // 모자 레이어도 같은 흐름에서 만들어 공룡 프레임과 동시에 바꾼다 (프레임 전환 시 모자가 한 박자 늦게 따라오지 않게)
      const hat = hatSrc && marker && attachPoint
        ? await composeItemLayer(
          hatSrc,
          attachPoint,
          rotation,
          marker.width + rightInset,
          marker.height,
          hatInset,
        ).catch(() => null)
        : null;

      // 색/프레임이 그 사이 또 바뀌어 더 최신 요청이 나갔다면 이 결과는 버린다
      // (늦게 끝난 이전 요청이 최신 프레임을 덮어써서 깜빡이는 것을 방지).
      if (recolorRequestIdRef.current !== requestId) return;
      setRecoloredSprite(padded);
      setRecoloredSpriteInset(hatInset);
      setHatLayer(hat);
    })();
  }, [sprite, petColor, hatInset, hatItem, hatImageSizes]);

  // 마커가 없는 프레임은 hatLayer가 null이라 모자가 표시되지 않는다
  const showHat = hasHat && hatLayer !== null && imageSize.width > 0;

  useEffect(() => {
    // 배율이 다른 모니터로 옮겨가면 devicePixelRatio가 바뀌므로 다시 구독한다
    let query: MediaQueryList | undefined;
    const subscribe = () => {
      query?.removeEventListener("change", onChange);
      query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      query.addEventListener("change", onChange);
    };
    const onChange = () => {
      setDevicePixelRatio(window.devicePixelRatio || 1);
      subscribe();
    };

    subscribe();
    return () => query?.removeEventListener("change", onChange);
  }, []);

  const renderScale = snapScaleToDevicePixels(petScale, devicePixelRatio);

  useEffect(() => {
    if (!imageSize.width) return;
    // renderScale이 바뀌면(모니터 이동 등) main도 새 배율로 창 크기를 다시 계산하도록 다시 보낸다
    window.electronAPI.resizePet(imageSize.width, imageSize.height, imageSize.inset);
  }, [imageSize, renderScale]);

  // 공룡과 모자 레이어가 공유하는 박스 크기 (위쪽 여백 포함)
  const layerStyle = {
    width: imageSize.width ? imageSize.width * renderScale : undefined,
    height: imageSize.width ? (imageSize.height + imageSize.inset) * renderScale : undefined,
    pointerEvents: "none",
  } as const;

  return (
    // 💡 .pet div 자체에 grab 커서가 먹히도록 설정 (CSS에서 세팅)
    <div
      className="pet"
      onMouseDown={onPetMouseDown}
      onMouseMove={onPetMouseMove}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* 공룡과 아이템을 같은 컨테이너에 두고 컨테이너에만 scaleX를 걸어 함께 뒤집는다 */}
      <div
        style={{
          position: "relative",
          width: layerStyle.width ?? "100%",
          height: layerStyle.height ?? "100%",
          transform: `scaleX(${direction})`,
          pointerEvents: "none",
        }}
      >
        <img
          // 치환이 끝나기 전(또는 아직 한 번도 끝난 적 없을 때)에는 원본 sprite를
          // 그대로 보여줘서 깜빡임 없이 이전 프레임 → 원본 → 치환본 순으로 자연스럽게 이어지게 한다.
          src={recoloredSprite ?? sprite}
          alt="pet"
          draggable={false}
          onLoad={(event) => {
            const image = event.currentTarget;
            // 로드된 이미지에 붙어 있는 여백을 빼서 원본 스프라이트 크기를 기록한다.
            // 창 크기 반영(resizePet)은 위 effect에서 처리
            const inset = recoloredSprite ? recoloredSpriteInset : 0;
            setImageSize({ width: image.naturalWidth, height: image.naturalHeight - inset, inset });
          }}
          style={layerStyle}
        />
        {showHat && (
          // 공룡 이미지와 완전히 같은 박스에 겹쳐서 픽셀 경계를 일치시킨다
          <img
            src={hatLayer}
            alt=""
            draggable={false}
            style={{ ...layerStyle, position: "absolute", top: 0, left: 0 }}
          />
        )}
      </div>
    </div>
  );
}

// 썸네일 칸 크기(px, index.css의 .wardrobe-thumb와 맞춤)
const WARDROBE_THUMB_SIZE = 48;

// 도트 아이템 썸네일. 칸에 맞춰 1.2배처럼 소수 배율로 늘리면 도트 폭이 들쭉날쭉해지므로,
// 칸 안에 들어가는 가장 큰 "물리 픽셀 정수 배율"로 그린다.
function ItemThumb({ src }: { src: string }) {
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const devicePixelRatio = window.devicePixelRatio || 1;
  const boxPixels = WARDROBE_THUMB_SIZE * devicePixelRatio;
  const scale = naturalSize
    ? Math.max(1, Math.floor(Math.min(boxPixels / naturalSize.width, boxPixels / naturalSize.height))) / devicePixelRatio
    : 0;

  return (
    <img
      src={src}
      alt=""
      draggable={false}
      onLoad={(event) => {
        const image = event.currentTarget;
        setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
      }}
      style={naturalSize
        ? { width: naturalSize.width * scale, height: naturalSize.height * scale }
        : { visibility: "hidden" }}
    />
  );
}

function WardrobeWindow() {
  const [equippedItems, setEquippedItems] = useState<EquippedItems>(readStoredEquippedItems);
  const [activeSlot, setActiveSlot] = useState<ItemSlot>("head");
  const activeSlotLabel = WARDROBE_SLOTS.find(({ slot }) => slot === activeSlot)?.label ?? "";
  const slotItems = WARDROBE_ITEMS.filter((item) => item.slot === activeSlot);

  // 이미 입고 있는 아이템을 다시 누르면 벗는다
  const toggleItem = (slot: ItemSlot, id: string) => {
    const next = { ...equippedItems, [slot]: equippedItems[slot] === id ? null : id };
    setEquippedItems(next);
    writeStoredEquippedItems(next);
  };

  return (
    <main className="wardrobe-window" onContextMenu={(event) => event.preventDefault()}>
      <div className="settings-titlebar">
        <h1>옷장</h1>
        <button type="button" className="settings-close" onClick={() => window.electronAPI.closeWardrobe()} aria-label="닫기">
          ×
        </button>
      </div>
      <div className="wardrobe-tabs" role="tablist">
        {WARDROBE_SLOTS.map(({ slot, label }) => (
          <button
            key={slot}
            type="button"
            role="tab"
            aria-selected={slot === activeSlot}
            className="wardrobe-tab"
            onClick={() => setActiveSlot(slot)}
          >
            {label}
          </button>
        ))}
      </div>
      {slotItems.length === 0 ? (
        <p className="wardrobe-empty">아직 {activeSlotLabel}이 없어요</p>
      ) : (
        <div className="wardrobe-grid" role="tabpanel">
          {slotItems.map((item) => {
            const isEquipped = equippedItems[item.slot] === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className="wardrobe-item"
                aria-pressed={isEquipped}
                title={isEquipped ? `${item.name} 벗기` : `${item.name} 입기`}
                onClick={() => toggleItem(item.slot, item.id)}
              >
                <span className="wardrobe-thumb">
                  <ItemThumb src={item.src} />
                </span>
                <span className="wardrobe-name">{item.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </main>
  );
}

function App() {
  if (isEmotionMenu) return <EmotionMenu />;
  if (isSettingsWindow) return <SettingsWindow />;
  if (isWardrobeWindow) return <WardrobeWindow />;
  return <Pet />;
}

export default App;
