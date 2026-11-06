import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { ObjectShape, pickArt } from "../art/ObjectShape";
import { kindColors } from "../art/palette";
import { ductLength, kindParts, kindSummary } from "../art/duct";
import { RoomFaceArt } from "./RoomFace";
import { centerOf, cue } from "./useFrodo";
import { lastActivity, relativeDay } from "../domain/care";
import { heroLayout, namedPaper, type Card, type HeroNode, type MoreSpot } from "../domain/heroLayout";
import { formatBytes, kindLabels, type Room, type Thing } from "../domain/model";
import { hash, sky, stageUnit, stepRoom, toPx, vaseHalf, vaseLift, vaseUnit, type RoomStat, type View } from "../domain/sky";
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
  const [hoverRoom, setHoverRoom] = useState<string | null>(null);
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
    const { nodes, cards, more } = heroLayout(rooms, now, view, paperAspect, doorOpen);
    // 고른 방과 그 파일들이 화면을 채우도록 확대하고 가운데로 옮깁니다. 변환은 CSS가 부드럽게 이어 줍니다.
    const picked = nodes.find((item) => item.room.id === selectedId);
    let camera: Camera = null;
    if (picked) {
      const unit = stageUnit(view);
      const center = toPx(picked.at, view);
      const own = cards.filter((card) => card.room.id === selectedId).map((card) => {
        const at = toPx(card, view);
        return Math.hypot(at.x - center.x, at.y - center.y) + card.size * 0.75;
      });
      const reach = Math.max(vaseHalf(picked.r) * vaseLift * unit * vaseUnit + 48 * unit, ...own);
      const zoom = Math.min(2.4, Math.max(1, (0.4 * Math.min(view.w, view.h)) / reach));
      camera = { zoom, x: focusPoint.x - picked.at.x * zoom, y: focusPoint.y - picked.at.y * zoom };
    }
    return { ordered: nodes, cards, more, ids: nodes.map((item) => item.room.id), camera };
  }, [rooms, selectedId, now, view, doorOpen]);

  // 현관에 새 파일이 오면 모두 고개를 들어 그쪽을 봅니다.
  useEffect(() => {
    if (doorOpen) for (const { room } of ordered) cue(room.id, { face: "lookU", ms: 1200 });
  }, [doorOpen]);

  useHeroMotion(canvas, cards, ordered, view, selectedId);

  // 주름관이 사라지면 mouseleave가 오지 않으니, 지도에서 빠진 방의 강조와 말풍선은 여기서 지웁니다.
  if (hoverRoom && !ids.includes(hoverRoom)) setHoverRoom(null);
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
          cards={cards}
          more={more}
          unit={stageUnit(view)}
          ids={ids}
          camera={camera}
          stats={stats}
          selectedId={selectedId}
          focusId={focusId}
          hoverRoom={hoverRoom}
          onSelectRoom={onSelectRoom}
          onOpenRoom={onOpenRoom}
          onFocusThing={onFocusThing}
          onOpenThing={onOpenThing}
          onRoomMenu={onRoomMenu}
          onHoverRoom={setHoverRoom}
          onShowTip={showTip}
          onHideTip={hideTip}
          onCloseTip={closeTip}
        />
        <p id="sky-hint" className="sr-only">화살표로 방을 옮기고 Enter를 누르면 그 방으로 들어가요. 메뉴 키로는 홈에서 뺄 수 있어요.</p>
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
  more,
  unit,
  ids,
  camera,
  stats,
  selectedId,
  focusId,
  hoverRoom,
  onSelectRoom,
  onOpenRoom,
  onFocusThing,
  onOpenThing,
  onRoomMenu,
  onHoverRoom,
  onShowTip,
  onHideTip,
  onCloseTip,
}: {
  ordered: HeroNode[];
  cards: Card[];
  more: MoreSpot[];
  unit: number;
  ids: string[];
  camera: Camera;
  stats: Map<string, RoomStat>;
  selectedId: string | null;
  focusId: string | null;
  hoverRoom: string | null;
  onSelectRoom: (id: string | null) => void;
  onOpenRoom: (id: string) => void;
  onFocusThing: (roomId: string, thingId: string) => void;
  onOpenThing: (roomId: string, thingId: string) => void;
  onRoomMenu: OpenRoomMenu;
  onHoverRoom: (id: string | null) => void;
  onShowTip: (tip: Tip) => void;
  onHideTip: () => void;
  onCloseTip: () => void;
}) {
  const litId = selectedId ?? hoverRoom;
  // 탭 키로는 지도에 한 번만 들어옵니다. 고른 방이 없으면 첫 방이 들어오는 자리입니다.
  const [lastFocus, setLastFocus] = useState<string | null>(null);
  const tabStop = selectedId ?? (lastFocus && ids.includes(lastFocus) ? lastFocus : ids[0]);

  function onRoomKey(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenRoom(id);
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

  // 손가락이 판을 밀고 지나간 끝에서는 말풍선을 열지 않습니다.
  const pressed = useRef({ x: 0, y: 0 });
  const onPaperUp = (event: PointerEvent, card: Card) => {
    if (event.pointerType === "mouse") return;
    if (Math.hypot(event.clientX - pressed.current.x, event.clientY - pressed.current.y) < 10) onShowTip({ star: card, room: card.room });
  };

  return (
    <div className="sky-camera" style={{ transform: camera ? `translate(${(camera.x / sky.width) * 100}%, ${(camera.y / sky.height) * 100}%) scale(${camera.zoom})` : "none" }}>
      {/* 선은 비율 좌표라 종이와 어긋나지 않고, 굵기와 점선 간격은 화면 px를 지킵니다. */}
      <svg className="sky-lines" viewBox={`0 0 ${sky.width} ${sky.height}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        {ordered.map(({ room, at }) => (
          <g key={room.id} className={`links${litId === room.id ? " lit" : ""}`}>
            {cards.filter((card) => card.room.id === room.id).map((card) => (
              <line key={card.thing.id} x1={at.x} y1={at.y} x2={card.x} y2={card.y} stroke={kindColors[card.thing.kind]} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
            ))}
          </g>
        ))}
      </svg>
      {/* 종이는 마우스로만 고릅니다. 키보드와 화면 읽기 프로그램은 같은 파일을 오른쪽 목록에서 만납니다. */}
      <div className={`papers${selectedId ? " faded" : ""}`} aria-hidden="true">
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
                  onFocusThing(card.room.id, card.thing.id);
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
              onClick={() => onOpenRoom(room.id)}
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
                onHoverRoom(room.id);
                cue(room.id, { body: "wave" });
              }}
              onMouseMove={(event) => cue(room.id, { look: { x: event.clientX, y: event.clientY } })}
              onMouseLeave={() => {
                onHoverRoom(null);
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
        {/* 칸에 다 못 놓은 파일 수. 같은 일은 주름관을 눌러도 되니 탭 순서에는 넣지 않아요. */}
        {more.map(({ room, x, y, count }) => (
          <button key={room.id} type="button" className="room-more" tabIndex={-1} style={{ left: `${(x / sky.width) * 100}%`, top: `${(y / sky.height) * 100}%` }} aria-label={`${room.name} 파일 ${count}개 더, 방 열기`} onClick={() => onOpenRoom(room.id)} onMouseEnter={() => cue(room.id, { body: "nod" })}>
            +{count}개 더
          </button>
        ))}
      </div>
    </div>
  );
});
