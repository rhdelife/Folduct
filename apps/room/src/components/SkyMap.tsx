import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { ObjectShape, pickArt } from "../art/ObjectShape";
import { kindColors } from "../art/palette";
import { kindParts, kindSummary, vaseBands, vaseIndex, vasePaths } from "../art/vases";
import { budgetLevel } from "../domain/care";
import { heroLayout, namedPaper, type Card, type HeroNode, type NotebookGuide } from "../domain/heroLayout";
import { formatBytes, kindLabels, type Room, type Thing } from "../domain/model";
import { hash, labelsHideFrom, sky, stageUnit, stepRoom, toPx, vaseHalf, vaseLift, vaseUnit, type RoomStat, type View } from "../domain/sky";
import { vaseFill } from "../domain/dial";
import { roomMenuTriggers, type OpenRoomMenu } from "./ContextMenu";
import { useEngine } from "./home/engine";
import { useHeroMotion } from "./home/heroMotion";

// 방을 고르면 카메라가 지도 한가운데로 그 방을 끌어옵니다. 패널이 열린 만큼 지도 전체는 CSS가 옆으로 비켜 줍니다.
const focusPoint = { x: sky.width / 2, y: sky.height / 2 };

type Tip = { star: Card; room: Room };
type Camera = { zoom: number; x: number; y: number } | null;

const paperAspect = (thing: Thing) => {
  const art = pickArt(thing.kind, thing.id);
  return art.h / art.w;
};

// 공책 장면의 자리를 잽니다. 올라오는 중이라 transform이 먹지 않는 offset 값을 무대까지 더해요.
function measureNotebook(root: HTMLElement, view: View): NotebookGuide | null {
  const scene = root.closest(".home-sheet")?.querySelector<HTMLElement>(".scene-notebook");
  const stack = scene?.querySelector<HTMLElement>(".nb-stack");
  const sections = scene ? [...scene.querySelectorAll<HTMLElement>("[data-land]")] : [];
  if (!scene || !stack || sections.length !== 3) return null;
  const anchors = sections.map((section) => {
    const label = section.querySelector<HTMLElement>(".nb-label") ?? section;
    let [x, y] = [0, label.offsetHeight];
    for (let el: HTMLElement | null = label; el && el !== scene; el = el.offsetParent as HTMLElement | null) {
      x += el.offsetLeft;
      y += el.offsetTop;
    }
    return { x, y };
  });
  // 공책 위에 띠 한 줄 자리가 비어 있습니다(--nb-top).
  const beltRow = Math.min(90, Math.max(36, view.w * 0.07));
  return { anchors, sheetW: stack.offsetWidth, beltY: stack.offsetTop - view.h * 0.02 - beltRow / 2 };
}

// 집: 빛을 받는 하얀 판 위의 방 지도. 파일은 형식별 색(이미지 노랑·글 초록·영상 파랑·PDF/문서 빨강…)의 종이 오브제로 떠 있습니다.
// 완료한 방은 지도에 놓지 않고, 메뉴의 완료된 프로젝트 목록에 둡니다.
export function SkyMap({
  rooms,
  stats,
  now,
  selectedId,
  focusId,
  onSelectRoom,
  onFocusThing,
  onRoomMenu,
}: {
  rooms: Room[];
  stats: Map<string, RoomStat>;
  now: number;
  selectedId: string | null;
  focusId: string | null;
  onSelectRoom: (id: string | null) => void;
  onFocusThing: (roomId: string, thingId: string) => void;
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
    el.style.translate = `${Math.max(area.left - box.left, Math.min(0, right - box.right))}px`;
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
  const { ordered, cards, ids, camera } = useMemo(() => {
    const { nodes, cards } = heroLayout(rooms, now, view, paperAspect, selectedId);
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
    return { ordered: nodes, cards, ids: nodes.map((item) => item.room.id), camera };
  }, [rooms, selectedId, now, view]);

  const { atRest, vasesHome } = useHeroMotion(canvas, cards, ordered, view, selectedId, () => (canvas.current ? measureNotebook(canvas.current, view) : null));

  // 스와이프로 판을 떠나면 말풍선과 강조를 닫습니다.
  useEffect(() => {
    if (atRest) return;
    closeTip();
    setHoverRoom(null);
  }, [atRest, closeTip]);

  // 화병이 사라지면 mouseleave가 오지 않으니, 지도에서 빠진 방의 강조와 말풍선은 여기서 지웁니다.
  if (hoverRoom && !ids.includes(hoverRoom)) setHoverRoom(null);
  if (tip && !ids.includes(tip.room.id)) setTip(null);

  // 말풍선은 카메라가 옮긴 뒤의 별 자리에 둡니다. 판 가장자리에서는 안쪽으로 당기고, 위쪽 별은 아래로 뒤집습니다.
  const tipX = tip ? tip.star.x * (camera?.zoom ?? 1) + (camera?.x ?? 0) : 0;
  const tipY = tip ? tip.star.y * (camera?.zoom ?? 1) + (camera?.y ?? 0) : 0;

  return (
      <div className={`sky-canvas${selectedId ? " has-selection" : ""}${atRest ? "" : " away"}${vasesHome ? "" : " flown"}`} ref={canvas}>
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
          unit={stageUnit(view)}
          ids={ids}
          camera={camera}
          stats={stats}
          selectedId={selectedId}
          focusId={focusId}
          hoverRoom={hoverRoom}
          onSelectRoom={onSelectRoom}
          onFocusThing={onFocusThing}
          onRoomMenu={onRoomMenu}
          onHoverRoom={setHoverRoom}
          onShowTip={showTip}
          onHideTip={hideTip}
          onCloseTip={closeTip}
        />
        <p id="sky-hint" className="sr-only">화살표로 방을 옮기고 Enter로 고르면 파일 목록이 열려요. 메뉴 키로는 완료된 프로젝트로 옮길 수 있어요.</p>
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
            {tip.star.stage !== "normal" && <em>{tip.star.days}일째 그대로 · {tip.star.stage === "fallen" ? "쓰러짐" : "기울어짐"}</em>}
            {!tip.star.thing.spot && <em className="calm">아직 선반 위</em>}
          </div>
        )}
      </div>
  );
}

// 선·종이·방 층. 말풍선 상태를 받지 않으므로, 종이 위를 오가도 다시 그리지 않습니다.
// 화병과 종이는 HTML 층에 둡니다. 합성 레이어라 떠다니고 커져도 지도를 다시 그리지 않아 방이 많아도 부드럽습니다.
const MapLayers = memo(function MapLayers({
  ordered,
  cards,
  unit,
  ids,
  camera,
  stats,
  selectedId,
  focusId,
  hoverRoom,
  onSelectRoom,
  onFocusThing,
  onRoomMenu,
  onHoverRoom,
  onShowTip,
  onHideTip,
  onCloseTip,
}: {
  ordered: HeroNode[];
  cards: Card[];
  unit: number;
  ids: string[];
  camera: Camera;
  stats: Map<string, RoomStat>;
  selectedId: string | null;
  focusId: string | null;
  hoverRoom: string | null;
  onSelectRoom: (id: string | null) => void;
  onFocusThing: (roomId: string, thingId: string) => void;
  onRoomMenu: OpenRoomMenu;
  onHoverRoom: (id: string | null) => void;
  onShowTip: (tip: Tip) => void;
  onHideTip: () => void;
  onCloseTip: () => void;
}) {
  const engine = useEngine();
  const litId = selectedId ?? hoverRoom;
  // 탭 키로는 지도에 한 번만 들어옵니다. 고른 방이 없으면 첫 방이 들어오는 자리입니다.
  const [lastFocus, setLastFocus] = useState<string | null>(null);
  const tabStop = selectedId ?? (lastFocus && ids.includes(lastFocus) ? lastFocus : ids[0]);

  function onRoomKey(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectRoom(selectedId === id ? null : id);
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
    // 패널이 열려 있으면 고르기도 따라갑니다. 카메라가 그 화병을 가운데로 데려와 패널 뒤에 숨지 않아요.
    if (document.querySelector(".sky-panel.open")) onSelectRoom(next);
  }

  // 손가락이 판을 밀고 지나간 끝에서는 말풍선을 열지 않습니다.
  const pressed = useRef({ x: 0, y: 0 });
  const onPaperUp = (event: PointerEvent, card: Card) => {
    if (event.pointerType === "mouse" || engine.pos > 5) return;
    if (Math.hypot(event.clientX - pressed.current.x, event.clientY - pressed.current.y) < 10) onShowTip({ star: card, room: card.room });
  };

  return (
    <div className="sky-camera" style={{ transform: camera ? `translate(${(camera.x / sky.width) * 100}%, ${(camera.y / sky.height) * 100}%) scale(${camera.zoom})` : "none" }}>
      {/* 선은 비율 좌표라 종이와 어긋나지 않고, 굵기와 점선 간격은 화면 px를 지킵니다. */}
      <svg className="sky-lines" viewBox={`0 0 ${sky.width} ${sky.height}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        {ordered.map(({ room, at }) => (
          <g key={room.id} className={`links${litId === room.id ? " lit" : ""}`}>
            {cards.filter((card) => card.room.id === room.id).map((card) => (
              <line key={card.thing.id} x1={at.x} y1={at.y} x2={card.x} y2={card.y} stroke={kindColors[card.thing.kind]} strokeDasharray={card.stage === "fallen" ? "2 6" : "4 4"} vectorEffect="non-scaling-stroke" />
            ))}
          </g>
        ))}
      </svg>
      <svg className="sky-defs" aria-hidden="true" focusable="false">
        <defs>{vasePaths.map((path, index) => <clipPath key={index} id={`vase-clip-${index}`}><path d={path} /></clipPath>)}</defs>
      </svg>
      {/* 종이는 마우스로만 고릅니다. 키보드와 화면 읽기 프로그램은 같은 파일을 오른쪽 목록에서 만납니다. */}
      <div className={`papers${selectedId ? " faded" : ""}`} aria-hidden="true">
        {cards.map((card, index) => {
          const own = card.room.id === selectedId;
          const focused = card.thing.id === focusId;
          return (
            <div
              key={card.thing.id}
              className={`paper stage-${card.stage}${own ? " lifted" : ""}${card.extra ? " extra" : ""}${focused ? " focused" : ""}`}
              data-card={card.thing.id}
              data-rot={card.rot}
              style={{ left: `${(card.x / sky.width) * 100}%`, top: `${(card.y / sky.height) * 100}%`, width: card.size, height: card.height, marginLeft: -card.size / 2, marginTop: -card.height / 2, "--i": index % 12 } as CSSProperties}
            >
              <div
                className="paper-art"
                style={{ rotate: `${card.rot}deg` }}
                onClick={() => onFocusThing(card.room.id, card.thing.id)}
                onPointerDown={(event) => (pressed.current = { x: event.clientX, y: event.clientY })}
                onPointerUp={(event) => onPaperUp(event, card)}
                onMouseEnter={() => onShowTip({ star: card, room: card.room })}
                onMouseLeave={onHideTip}
              >
                {focused && <span className="paper-pulse pulse" style={{ borderColor: kindColors[card.thing.kind] }} />}
                <ObjectShape kind={card.thing.kind} size={card.size} name={card.thing.name} seed={card.thing.id} nameFrom={namedPaper} />
              </div>
            </div>
          );
        })}
      </div>
      {/* 방이 8개부터는 이름표가 겹치니, 고르거나 가리킨 방만 이름을 보입니다. */}
      <div className={`sky-rooms${ids.length >= labelsHideFrom ? " crowded" : ""}`} style={{ "--u": `${unit * vaseUnit}px` } as CSSProperties} role="group" aria-label="내 방 지도. 화병은 방, 작은 오브제는 파일이에요. 화병이 찬 높이는 한도 대비 용량이고, 색은 파일 형식이에요. 한도가 없는 방은 형식 비율만 보여요. 손대지 않은 파일일수록 멀리 떠 있어요." aria-describedby="sky-hint">
        {ordered.map(({ room, at, r }) => {
          const { usage } = stats.get(room.id)!;
          const level = budgetLevel(usage, room.budgetBytes);
          const vase = vaseIndex(room.id);
          const parts = kindParts(room.things);
          const ratio = level === "partial" ? 0 : vaseFill(room, usage.totalBytes);
          const bands = vaseBands(parts, ratio);
          const size = level === "partial" ? `최소 ${formatBytes(usage.totalBytes)}` : room.budgetBytes ? `${formatBytes(usage.totalBytes)} / ${formatBytes(room.budgetBytes)}` : formatBytes(usage.totalBytes);
          // 상태는 새 색 없이 먹색 굵은 글자로 말합니다.
          const warn = level === "near" ? "한도에 거의 참" : level === "over" ? "한도 넘음" : "";
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
              aria-label={`${room.name} 방, ${size}${warn ? `, ${warn}` : ""}${parts.length ? `, ${kindSummary(parts)}` : ""}`}
              onClick={() => onSelectRoom(selectedId === room.id ? null : room.id)}
              onContextMenu={menu.onContextMenu}
              onFocus={() => setLastFocus(room.id)}
              onKeyDown={(event) => {
                menu.onKeyDown(event);
                onRoomKey(event, room.id);
              }}
              onMouseEnter={() => onHoverRoom(room.id)}
              onMouseLeave={() => onHoverRoom(null)}
            >
              <span className="vase-lift">
                <span className="vase-shadow" />
                <span className="vase-float">
                  <svg className="vase-art" viewBox="-100 -100 200 200" aria-hidden="true" focusable="false">
                    <path className="vase-body" d={vasePaths[vase]} />
                    {/* 목록의 색 막대처럼 형식별 용량이 바닥부터 쌓입니다. */}
                    <g clipPath={`url(#vase-clip-${vase})`}>
                      {bands.map((band) => <rect key={band.label} className="vase-band" x={-100} y={band.y} width={200} height={band.height} fill={band.color} />)}
                    </g>
                    <path className={`vase-line level-${level}`} d={vasePaths[vase]} />
                  </svg>
                </span>
              </span>
              <span className="vase-tag">
                <span className="room-label">{room.name}</span>
                <span className="room-sub">
                  {size}
                  {warn && <b> · {warn}</b>}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
});
