import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { ObjectShape, pickArt } from "../art/ObjectShape";
import { kindColors } from "../art/palette";
import { ductLength, kindParts, kindSummary } from "../art/duct";
import { RoomFaceArt } from "./RoomFace";
import { centerOf, cue } from "./useFrodo";
import { lastActivity, relativeDay } from "../domain/care";
import { heroLayout, namedPaper, type Card, type HeroNode, type MoreSpot } from "../domain/heroLayout";
import { formatBytes, kindLabels, type Room, type Thing } from "../domain/model";
import { hash, sky, stageUnit, stepRoom, toPx, toSky, vaseHalf, vaseLift, vaseUnit, type RoomStat, type View } from "../domain/sky";
import { roomMenuTriggers, type OpenRoomMenu } from "./ContextMenu";
import { useHeroMotion } from "./home/heroMotion";

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
        <p id="sky-hint" className="sr-only">화살표로 방을 옮기고 Enter를 누르면 그 방 파일이 나와요. 한 번 더 누르면 방으로 들어가요. 메뉴 키로는 방 설정을 열 수 있어요.</p>
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
            {!tip.star.thing.spot && <em className="calm">아직 선반 위</em>}
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
    // 패널이 열려 있으면 고르기도 따라갑니다. 카메라가 그 주름관을 가운데로 데려와 패널 뒤에 숨지 않아요.
    if (document.querySelector(".sky-panel.open")) onSelectRoom(next);
  }

  // 처음 누르면 그 프로도에게 다가가 파일을 뱉게 하고, 고른 프로도를 한 번 더 누르면 방으로 들어갑니다.
  const pick = (id: string) => (id === selectedId ? onOpenRoom(id) : onSelectRoom(id));

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
                <ObjectShape kind={card.thing.kind} size={card.size} name={card.thing.name} seed={card.thing.id} nameFrom={namedPaper} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="sky-rooms" style={{ "--u": `${unit * vaseUnit}px` } as CSSProperties} role="group" aria-label="내 방들. 주름관은 방, 작은 오브제는 파일이에요. 관이 길수록 용량이 크고, 색은 파일 형식이에요. 파일은 각 주름관 아래에 최근 작업 순서로 놓여요." aria-describedby="sky-hint">
        {ordered.map(({ room, at, r }) => {
          const { usage } = stats.get(room.id)!;
          const parts = kindParts(room.things);
          const size = `${usage.exact ? "" : "최소 "}${formatBytes(usage.totalBytes)}`;
          const menu = roomMenuTriggers(room.id, onRoomMenu);
          return (
            <button
              key={room.id}
              type="button"
              data-room-id={room.id}
              className={`room-node${selectedId === room.id ? " selected" : ""}${selectedId && selectedId !== room.id ? " dim" : ""}`}
              style={{ left: `${(at.x / sky.width) * 100}%`, top: `${(at.y / sky.height) * 100}%`, "--half": vaseHalf(r), "--lift": vaseLift, "--phase": hash(room.id, 3) } as CSSProperties}
              tabIndex={room.id === tabStop ? 0 : -1}
              aria-pressed={selectedId === room.id}
              aria-label={`${room.name} 방, ${size}${parts.length ? `, ${kindSummary(parts)}` : ""}`}
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
              <span className="vase-lift">
                <span className="vase-float">
                  <RoomFaceArt face={room.face} parts={usage.exact ? parts : []} length={ductLength(usage.totalBytes)} px={Math.round((vaseHalf(r) * 2 * unit * vaseUnit) / 8) * 8} className="vase-art" actor={room.id} mood={selectedId === room.id ? "happy" : selectedId ? "shut" : "base"} />
                </span>
              </span>
              <span className="vase-tag">
                <span className="room-label">{room.name}</span>
                <span className="room-sub">{size}</span>
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
