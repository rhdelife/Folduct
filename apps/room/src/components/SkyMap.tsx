import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { ObjectShape, pickArt } from "../art/ObjectShape";
import { kindColors } from "../art/palette";
import { ductLength, kindParts, kindSummary } from "../art/duct";
import { RoomFaceArt } from "./RoomFace";
import { centerOf, cue } from "./useFrodo";
import { laneOf, lastActivity, relativeDay } from "../domain/care";
import { heroLayout, namedPaper, type Card, type HeroNode, type MoreSpot } from "../domain/heroLayout";
import { formatBytes, kindLabels, type Room, type Thing } from "../domain/model";
import { hash, sky, stageUnit, stepRoom, toPx, toSky, vaseHalf, vaseLift, vaseUnit, type RoomStat, type View } from "../domain/sky";
import { roomMenuTriggers, type OpenRoomMenu } from "./ContextMenu";
import { useHeroMotion } from "./home/heroMotion";
import { WheelStepper } from "../domain/wheelStep";
import { folderAccess, type Folder } from "../gateways/native";
import { roomFolder } from "../storage/box";
import { usePicture } from "../storage/pictures";
import { coverOf, useThumb } from "../storage/thumbs";

// 방을 고르면 카메라가 지도 한가운데로 그 방을 끌어옵니다. 패널이 열린 만큼 지도 전체는 CSS가 옆으로 비켜 줍니다.
const focusPoint = { x: sky.width / 2, y: sky.height / 2 };

type Tip = { star: Card; room: Room };
type Camera = { zoom: number; x: number; y: number } | null;

const paperAspect = (thing: Thing) => {
  const art = pickArt(thing.kind, thing.id);
  return art.h / art.w;
};

// 집: 빛을 받는 하얀 판 위의 방 지도. 파일은 형식별 색(이미지 노랑·글 초록·영상 파랑·PDF/문서 빨강…)의 종이 오브제로 떠 있습니다.
// 홈에서 뺀 방은 지도에 놓지 않고, 메뉴의 방 목록에 둡니다.
export function SkyMap({
  rooms,
  stats,
  now,
  selectedId,
  focusId,
  doorOpen,
  onSelectRoom,
  onOpenRoom,
  onFocusThing,
  onOpenThing,
  onRoomMenu,
}: {
  rooms: Room[];
  stats: Map<string, RoomStat>;
  now: number;
  selectedId: string | null;
  focusId: string | null;
  doorOpen: boolean;
  onSelectRoom: (id: string | null) => void;
  onOpenRoom: (id: string) => void;
  onFocusThing: (roomId: string, thingId: string) => void;
  onOpenThing: (roomId: string, thingId: string) => void;
  onRoomMenu: OpenRoomMenu;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(() => ({ w: window.innerWidth || 1, h: window.innerHeight || 1 }));
  const [tip, setTip] = useState<Tip | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const tipBox = useRef<HTMLDivElement>(null);

  // 말풍선은 창과 열린 패널 안쪽으로 밀어 넣습니다. 지도 좌표로는 실제 글자 폭과 패널 자리를 알 수 없어 그린 뒤에 잽니다.
  useLayoutEffect(() => {
    const el = tipBox.current;
    if (!el) return;
    el.style.translate = "";
    const box = el.getBoundingClientRect();
    const area = el.closest(".sky-layout")!.getBoundingClientRect();
    const open = document.querySelector(".sky-panel.open")?.getBoundingClientRect();
    // 폰의 아래 패널은 폭 전체를 쓰니 옆 패널만 오른쪽 끝을 줄입니다.
    const right = open && open.left > area.left ? open.left : area.right;
    el.style.translate = `${Math.max(area.left - box.left, Math.min(0, right - box.right))}px 0`;
  }, [tip]);

  const showTip = useCallback((next: Tip) => {
    clearTimeout(closeTimer.current);
    setTip(next);
  }, []);
  // 별에서 말풍선으로 옮겨 가는 사이에 닫히지 않게 조금 기다립니다.
  const hideTip = useCallback(() => {
    clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setTip(null), 150);
  }, []);
  const closeTip = useCallback(() => {
    clearTimeout(closeTimer.current);
    setTip(null);
  }, []);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => {
    if (!tip) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeTip();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [tip, closeTip]);

  // 무대는 창 전체입니다. 크기가 바뀔 때만 다시 배치해요.
  useLayoutEffect(() => {
    const el = canvas.current!;
    // 창이 아직 그려지기 전이면 폭이 0이라 좌표가 NaN이 됩니다. 지난 값을 둡니다.
    const measure = () => el.clientWidth > 0 && el.clientHeight > 0 && setView((old) => (old.w === el.clientWidth && old.h === el.clientHeight ? old : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 종이 위에 마우스를 올려도 배치는 다시 계산하지 않습니다.
  const { ordered, cards, more, ids, camera } = useMemo(() => {
    const { nodes, cards, more } = heroLayout(rooms, now, view, paperAspect, doorOpen, selectedId);
    // 고른 프로도와 뱉은 파일, 방 열기 단추가 한눈에 들어오게 다가갑니다. 변환은 CSS가 부드럽게 이어 줍니다.
    const picked = nodes.find((item) => item.room.id === selectedId);
    let camera: Camera = null;
    if (picked) {
      const center = toPx(picked.at, view);
      const half = vaseHalf(picked.r) * vaseLift * stageUnit(view) * vaseUnit;
      const opener = more.find((spot) => spot.room.id === selectedId);
      const xs = [center.x - half, center.x + half];
      const ys = [center.y + vaseHalf(picked.r) * stageUnit(view) * vaseUnit - 2 * half, opener ? toPx(opener, view).y + 24 : center.y + half];
      for (const card of cards.filter((item) => item.room.id === selectedId)) {
        const at = toPx(card, view);
        xs.push(at.x - card.size / 2, at.x + card.size / 2);
      }
      const box = { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
      const zoom = Math.min(2.4, Math.max(1, Math.min((0.9 * view.w) / (box.right - box.left), (0.82 * view.h) / (box.bottom - box.top))));
      const mid = toSky({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 }, view);
      camera = { zoom, x: focusPoint.x - mid.x * zoom, y: focusPoint.y + 30 - mid.y * zoom };
    }
    return { ordered: nodes, cards, more, ids: nodes.map((item) => item.room.id), camera };
  }, [rooms, selectedId, now, view, doorOpen]);

  // 현관에 새 파일이 오면 모두 고개를 들어 그쪽을 봅니다.
  useEffect(() => {
    if (doorOpen) for (const { room } of ordered) cue(room.id, { face: "lookU", ms: 1200 });
  }, [doorOpen]);

  // 평소에는 주름관만 보입니다. 고른 방의 파일만 그 주름관 아래로 나와요.
  const shown = useMemo(() => cards.filter((card) => card.room.id === selectedId), [cards, selectedId]);
  const opener = more.find((spot) => spot.room.id === selectedId) ?? null;
  useHeroMotion(canvas, shown, ordered, view, selectedId);

  // 화살표와 휠로 프로도 사이를 옮겨 다닙니다. 옮겨 간 프로도에게 다가가고, 그 프로도가 파일을 뱉어요.
  const step = useRef<(key: string) => void>(() => {});
  step.current = (key) => {
    const next = stepRoom(ids, selectedId, key);
    if (!next || next === selectedId) return;
    closeTip();
    onSelectRoom(next);
    // Enter를 한 번 더 누르면 그 방으로 들어가도록 포커스도 따라갑니다.
    canvas.current?.querySelector<HTMLElement>(`.room-node[data-room-id="${CSS.escape(next)}"]`)?.focus({ preventScroll: true });
  };
  useEffect(() => {
    // 대화상자·메뉴가 떠 있거나, 글을 쓰는 중이거나, 옆으로 미는 현관 줄 위에서는 건드리지 않아요.
    const blocked = (target: EventTarget | null) => document.querySelector("dialog[open], .context-menu") !== null || (target instanceof Element && target.closest("input, textarea, select, [contenteditable], .doorstep") !== null);
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || !keys.includes(event.key) || blocked(event.target)) return;
      event.preventDefault();
      step.current(event.key);
    };
    // 휠 한 칸, 트랙패드 한 번 쓸기마다 한 칸 갑니다(domain/wheelStep.ts). 막혀 있을 때도 흐름은 읽어 둬야
    // 대화상자를 닫은 뒤 남은 관성을 새 손짓으로 착각하지 않아요.
    const wheel = new WheelStepper();
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      const dir = wheel.push(event);
      if (dir === 0 || blocked(event.target)) return;
      step.current(dir > 0 ? "ArrowRight" : "ArrowLeft");
    };
    document.addEventListener("keydown", onKey);
    addEventListener("wheel", onWheel, { passive: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      removeEventListener("wheel", onWheel);
    };
  }, []);

  // 주름관이 사라지면 mouseleave가 오지 않으니, 지도에서 빠진 방의 강조와 말풍선은 여기서 지웁니다.
  if (tip && !ids.includes(tip.room.id)) setTip(null);

  // 말풍선은 카메라가 옮긴 뒤의 별 자리에 둡니다. 판 가장자리에서는 안쪽으로 당기고, 위쪽 별은 아래로 뒤집습니다.
  const tipX = tip ? tip.star.x * (camera?.zoom ?? 1) + (camera?.x ?? 0) : 0;
  const tipY = tip ? tip.star.y * (camera?.zoom ?? 1) + (camera?.y ?? 0) : 0;

  return (
      <div className={`sky-canvas${selectedId ? " has-selection" : ""}`} ref={canvas}>
        <div
          className="sky-backdrop"
          onClick={() => {
            onSelectRoom(null);
            closeTip();
          }}
        />
        <MapLayers
          ordered={ordered}
          cards={shown}
          opener={opener}
          unit={stageUnit(view)}
          ids={ids}
          camera={camera}
          stats={stats}
          selectedId={selectedId}
          focusId={focusId}
          onSelectRoom={onSelectRoom}
          onOpenRoom={onOpenRoom}
          onFocusThing={onFocusThing}
          onOpenThing={onOpenThing}
          onRoomMenu={onRoomMenu}
          onShowTip={showTip}
          onHideTip={hideTip}
          onCloseTip={closeTip}
        />
        <p id="sky-hint" className="sr-only">화살표나 휠로 프로도를 옮겨 다니면 그 방 파일이 나와요. Enter를 누르면 방으로 들어가요. Esc로 돌아오고, 메뉴 키로는 방 설정을 열 수 있어요.</p>
        {tip && (
          <div
            ref={tipBox}
            className={`sky-tip${tipY < 140 ? " below" : ""}`}
            aria-hidden="true"
            style={{ left: `${(Math.min(880, Math.max(120, tipX)) / sky.width) * 100}%`, top: `${(tipY / sky.height) * 100}%` }}
            onMouseEnter={() => clearTimeout(closeTimer.current)}
            onMouseLeave={hideTip}
          >
            <strong>{tip.star.thing.name}</strong>
            <span>{tip.room.name} · {kindLabels[tip.star.thing.kind]} · {formatBytes(tip.star.thing.size)}</span>
            <span>{relativeDay(lastActivity(tip.star.thing), now)} 작업</span>
            {tip.star.stale && <em>{tip.star.days}일째 그대로</em>}
            {laneOf(tip.star.thing, tip.room, now) === "new" && <em className="calm">새로 왔어요</em>}
          </div>
        )}
      </div>
  );
}

// 선·종이·방 층. 말풍선 상태를 받지 않으므로, 종이 위를 오가도 다시 그리지 않습니다.
// 주름관과 종이는 HTML 층에 둡니다. 합성 레이어라 숨쉬고 커져도 지도를 다시 그리지 않아 방이 많아도 부드럽습니다.
const MapLayers = memo(function MapLayers({
  ordered,
  cards,
  opener,
  unit,
  ids,
  camera,
  stats,
  selectedId,
  focusId,
  onSelectRoom,
  onOpenRoom,
  onFocusThing,
  onOpenThing,
  onRoomMenu,
  onShowTip,
  onHideTip,
  onCloseTip,
}: {
  ordered: HeroNode[];
  cards: Card[];
  opener: MoreSpot | null;
  unit: number;
  ids: string[];
  camera: Camera;
  stats: Map<string, RoomStat>;
  selectedId: string | null;
  focusId: string | null;
  onSelectRoom: (id: string | null) => void;
  onOpenRoom: (id: string) => void;
  onFocusThing: (roomId: string, thingId: string) => void;
  onOpenThing: (roomId: string, thingId: string) => void;
  onRoomMenu: OpenRoomMenu;
  onShowTip: (tip: Tip) => void;
  onHideTip: () => void;
  onCloseTip: () => void;
}) {
  // 탭 키로는 지도에 한 번만 들어옵니다. 고른 방이 없으면 첫 방이 들어오는 자리입니다.
  const [lastFocus, setLastFocus] = useState<string | null>(null);
  const tabStop = selectedId ?? (lastFocus && ids.includes(lastFocus) ? lastFocus : ids[0]);

  function onRoomKey(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick(id);
      return;
    }
    if (event.key === "Escape") {
      onSelectRoom(null);
      onCloseTip();
      return;
    }
    const next = stepRoom(ids, id, event.key);
    if (!next) return;
    event.preventDefault();
    event.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-room-id="${CSS.escape(next)}"]`)?.focus();
    // 고르기도 따라가 그 프로도에게 다가갑니다.
    onSelectRoom(next);
  }

  // 처음 누르면 그 프로도에게 다가가 파일을 뱉게 하고, 고른 프로도를 한 번 더 누르면 방으로 들어갑니다.
  const pick = (id: string) => (id === selectedId ? onOpenRoom(id) : onSelectRoom(id));

  const folders = useReadableFolders(ordered.map((node) => node.room));
  // 손가락이 판을 밀고 지나간 끝에서는 말풍선을 열지 않습니다.
  const pressed = useRef({ x: 0, y: 0 });
  const onPaperUp = (event: PointerEvent, card: Card) => {
    if (event.pointerType === "mouse") return;
    if (Math.hypot(event.clientX - pressed.current.x, event.clientY - pressed.current.y) < 10) onShowTip({ star: card, room: card.room });
  };

  return (
    <div className="sky-camera" style={{ transform: camera ? `translate(${(camera.x / sky.width) * 100}%, ${(camera.y / sky.height) * 100}%) scale(${camera.zoom})` : "none" }}>
      {/* 종이는 마우스로만 고릅니다. 키보드와 화면 읽기 프로그램은 같은 파일을 오른쪽 목록에서 만납니다. */}
      <div className="papers" aria-hidden="true">
        {cards.map((card, index) => {
          const own = card.room.id === selectedId;
          const focused = card.thing.id === focusId;
          return (
            <div
              key={card.thing.id}
              className={`paper${own ? " lifted" : ""}${focused ? " focused" : ""}`}
              data-card={card.thing.id}
              style={{ left: `${(card.x / sky.width) * 100}%`, top: `${(card.y / sky.height) * 100}%`, width: card.size, height: card.height, marginLeft: -card.size / 2, marginTop: -card.height / 2, "--i": index % 12 } as CSSProperties}
            >
              <div
                className="paper-art"
                style={{ rotate: `${card.rot}deg` }}
                onClick={() => {
                  cue(card.room.id, { body: "nod" });
                  onOpenThing(card.room.id, card.thing.id);
                }}
                onPointerDown={(event) => (pressed.current = { x: event.clientX, y: event.clientY })}
                onPointerUp={(event) => onPaperUp(event, card)}
                onMouseEnter={(event) => {
                  // 이 파일의 방 프로도만 종이를 바라봅니다.
                  cue(card.room.id, { look: centerOf(event.currentTarget) });
                  onShowTip({ star: card, room: card.room });
                }}
                onMouseLeave={() => {
                  cue(card.room.id, { look: null });
                  onHideTip();
                }}
              >
                {focused && <span className="paper-pulse pulse" style={{ borderColor: kindColors[card.thing.kind] }} />}
                <PaperShape card={card} folder={folders.get(card.room.id) ?? null} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="sky-rooms" style={{ "--u": `${unit * vaseUnit}px` } as CSSProperties} role="group" aria-label="내 방들. 주름관은 방, 작은 오브제는 파일이에요. 관이 길수록 용량이 크고, 색은 파일 형식이에요. 파일은 각 주름관 아래에 최근 작업 순서로 놓여요." aria-describedby="sky-hint">
        {ordered.map(({ room, at, r, card }) => {
          const { usage, stale } = stats.get(room.id)!;
          const parts = kindParts(room.things);
          const size = `${usage.exact ? "" : "최소 "}${formatBytes(usage.totalBytes)}`;
          const menu = roomMenuTriggers(room.id, onRoomMenu);
          return (
            <button
              key={room.id}
              type="button"
              data-room-id={room.id}
              className={`room-node${selectedId === room.id ? " selected" : ""}${selectedId && selectedId !== room.id ? " dim" : ""}`}
              style={{ left: `${(at.x / sky.width) * 100}%`, top: `${(at.y / sky.height) * 100}%`, "--half": vaseHalf(r), "--lift": vaseLift, "--phase": hash(room.id, 3), "--card-w": `${card.w}px`, "--card-h": `${card.h}px`, "--card-below": `${card.below}px` } as CSSProperties}
              tabIndex={room.id === tabStop ? 0 : -1}
              aria-pressed={selectedId === room.id}
              aria-label={`${room.name} 방, ${size}${stale > 0 ? `, 안 쓴 파일 ${stale}개` : ""}${parts.length ? `, ${kindSummary(parts)}` : ""}`}
              onClick={() => pick(room.id)}
              onContextMenu={(event) => {
                cue(room.id, { body: "tilt", face: "tilt", ms: 720 });
                menu.onContextMenu(event);
              }}
              onFocus={(event) => {
                setLastFocus(room.id);
                if (event.currentTarget.matches(":focus-visible")) cue(room.id, { body: "wave" });
              }}
              onKeyDown={(event) => {
                menu.onKeyDown(event);
                onRoomKey(event, room.id);
              }}
              onMouseEnter={() => {
                cue(room.id, { body: "wave" });
              }}
              onMouseMove={(event) => cue(room.id, { look: { x: event.clientX, y: event.clientY } })}
              onMouseLeave={() => {
                cue(room.id, { look: null });
              }}
            >
              {/* 카드와 바닥 그림자: 프로도가 허공에 뜨지 않고 제 칸에 서 있게 합니다. */}
              <span className="room-card" aria-hidden="true" />
              <span className="room-floor" aria-hidden="true" />
              <span className="vase-lift">
                <RoomCover room={room} folder={folders.get(room.id) ?? null} px={Math.round((vaseHalf(r) * 2 * unit * vaseUnit * 0.44) / 4) * 4} />
                <span className="vase-float">
                  <RoomFaceArt face={room.face} parts={usage.exact ? parts : []} length={ductLength(usage.totalBytes)} px={Math.round((vaseHalf(r) * 2 * unit * vaseUnit) / 8) * 8} className="vase-art" actor={room.id} mood={selectedId === room.id ? "happy" : selectedId ? "shut" : "base"} />
                </span>
              </span>
              <span className="vase-tag">
                <span className="room-label">{room.name}</span>
                <span className="room-sub">{size}{stale > 0 && <b> · 안 쓴 파일 {stale}개</b>}</span>
              </span>
            </button>
          );
        })}
        {/* 고른 방 파일 칸 아래의 방 열기. 칸에 다 못 놓은 파일 수도 함께 알려요. */}
        {opener && (
          <button key={opener.room.id} type="button" className="room-more" style={{ left: `${(opener.x / sky.width) * 100}%`, top: `${(opener.y / sky.height) * 100}%` }} onClick={() => onOpenRoom(opener.room.id)} onMouseEnter={() => cue(opener.room.id, { body: "nod" })}>
            {opener.count > 0 ? `방 열기 · ${opener.count}개 더` : "방 열기"}
          </button>
        )}
      </div>
    </div>
  );
});

// 권한을 묻지 않고 지금 읽을 수 있는 방 폴더들(방 id → 폴더). 샘플 방이나 브라우저에서 권한이 없는 방은 빠져요.
function useReadableFolders(rooms: Room[]): Map<string, Folder> {
  const [folders, setFolders] = useState(() => new Map<string, Folder>());
  const key = rooms.map((room) => `${room.id}:${room.source}:${room.origin ?? ""}`).join();
  useEffect(() => {
    let live = true;
    const readable = async (room: Room) => {
      const found = await roomFolder(room).catch(() => null);
      return found && (await folderAccess(found).catch(() => "unknown")) === "granted" ? ([room.id, found] as const) : null;
    };
    void Promise.all(rooms.map(readable)).then((list) => live && setFolders(new Map(list.filter((entry) => entry !== null))));
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return folders;
}

// 방의 대표 이미지 한 장을 받침 옆에 기대 세워요. 이름만으로 방을 찾지 않게, 방에서 가장 최근의 그림을 보여 줍니다.
// 그림을 읽기 전이거나 읽을 수 없으면 아무것도 그리지 않아요.
function RoomCover({ room, folder, px }: { room: Room; folder: Folder | null; px: number }) {
  const cover = useMemo(() => coverOf(room), [room.things]); // eslint-disable-line react-hooks/exhaustive-deps
  return cover ? <CoverPaper thing={cover} folder={folder} px={px} /> : null;
}

function CoverPaper({ thing, folder, px }: { thing: Thing; folder: Folder | null; px: number }) {
  const self = useRef<HTMLSpanElement>(null);
  const own = usePicture(thing.id);
  const thumb = useThumb(self, own ? null : folder, thing);
  const url = own ?? thumb;
  return (
    <span ref={self} className="room-cover" aria-hidden="true">
      {url && <ObjectShape kind={thing.kind} size={px} seed={thing.id} picture={url} />}
    </span>
  );
}

// 고른 방 아래에 놓인 파일 종이. 이미지면 진짜 미리보기를 끼워요(방 안과 같은 캐시).
function PaperShape({ card, folder }: { card: Card; folder: Folder | null }) {
  const self = useRef<HTMLSpanElement>(null);
  const own = usePicture(card.thing.id);
  const thumb = useThumb(self, own ? null : folder, card.thing);
  return (
    <span ref={self} className="paper-thumb">
      <ObjectShape kind={card.thing.kind} size={card.size} name={card.thing.name} seed={card.thing.id} nameFrom={namedPaper} picture={own ?? thumb} />
    </span>
  );
}
