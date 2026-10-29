import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { ObjectShape } from "../art/ObjectShape";
import { kindColors } from "../art/palette";
import { budgetLevel } from "../domain/care";
import { formatBytes, kindLabels, type Room } from "../domain/model";
import { layoutRooms, roomRadius, roomStars, sky, stepRoom, type Placed, type RoomStat, type Star } from "../domain/sky";
import { useFitScale } from "./useFitScale";

// 방을 고르면 카메라가 이 점으로 그 방을 끌어옵니다(왼쪽 위 요약 글자를 피해 오른쪽으로 조금 비켜 둠).
const focusPoint = { x: sky.centerX + 60, y: sky.height / 2 + 10 };

type Tip = { star: Star; room: Room };
type Camera = { zoom: number; x: number; y: number } | null;
type Node = Placed & { r: number; stars: Star[] };

// 집: 빛을 받는 하얀 판 위의 방 지도. 파일은 형식별 색(이미지 노랑·글 초록·영상 파랑·PDF/문서 빨강…)의 반투명한 오브제로 떠 있습니다.
// 완료한 방은 뒤쪽에 흐린 잔상처럼 남습니다.
export function SkyMap({
  rooms,
  stats,
  now,
  selectedId,
  focusId,
  onSelectRoom,
  onFocusThing,
  children,
}: {
  rooms: Room[];
  stats: Map<string, RoomStat>;
  now: number;
  selectedId: string | null;
  focusId: string | null;
  onSelectRoom: (id: string | null) => void;
  onFocusThing: (roomId: string, thingId: string) => void;
  children?: ReactNode;
}) {
  const [hoverRoom, setHoverRoom] = useState<string | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [canvas, k] = useFitScale<HTMLDivElement>(sky.width, Infinity);
  const closeTimer = useRef<number | undefined>(undefined);

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

  // 별 위에 마우스를 올려도 배치는 다시 계산하지 않습니다.
  const { ordered, ids, camera } = useMemo(() => {
    // 완료한 방의 파일은 그 방을 골랐을 때만 띄웁니다.
    const layout: Node[] = layoutRooms(rooms).map((placed) => ({
      ...placed,
      r: roomRadius(placed.room, placed.scale),
      stars: !placed.room.care.done || placed.room.id === selectedId ? roomStars(placed.room, placed.at, placed.spread, now, placed.limit, placed.scale) : [],
    }));
    // 고른 방과 그 파일들이 화면을 채우도록 확대하고 가운데로 옮깁니다. 변환은 CSS가 부드럽게 이어 줍니다.
    const picked = layout.find((item) => item.room.id === selectedId);
    let camera: Camera = null;
    if (picked) {
      const reach = Math.max(picked.r + 48, ...picked.stars.map((star) => Math.hypot(star.x - picked.at.x, star.y - picked.at.y) + star.r * 1.5));
      const zoom = Math.min(2.4, Math.max(1, 270 / reach));
      camera = { zoom, x: focusPoint.x - picked.at.x * zoom, y: focusPoint.y - picked.at.y * zoom };
    }
    return {
      // 흐린 잔상(완료)을 먼저 그려 뒤에 깔고, 진행 중인 방을 앞에 둡니다.
      ordered: [...layout.filter((item) => item.room.care.done), ...layout.filter((item) => !item.room.care.done)],
      // 화살표 순서는 진행 중인 방부터입니다.
      ids: layout.map((item) => item.room.id),
      camera,
    };
  }, [rooms, selectedId, now]);

  // 말풍선은 카메라가 옮긴 뒤의 별 자리에 둡니다. 판 가장자리에서는 안쪽으로 당기고, 위쪽 별은 아래로 뒤집습니다.
  const tipX = tip ? tip.star.x * (camera?.zoom ?? 1) + (camera?.x ?? 0) : 0;
  const tipY = tip ? tip.star.y * (camera?.zoom ?? 1) + (camera?.y ?? 0) : 0;

  return (
    <div className={`sky-map${selectedId ? " has-selection" : ""}`}>
      <div className="sky-canvas" ref={canvas} style={{ "--k": k } as CSSProperties}>
        <svg
          viewBox={`0 0 ${sky.width} ${sky.height}`}
          preserveAspectRatio="xMidYMid meet"
          role="group"
          aria-label="내 방 지도. 원은 방, 작은 오브제는 파일이에요. 손대지 않은 파일일수록 멀리 떠 있고, 완료한 방은 흐리게 보여요."
          aria-describedby="sky-hint"
        >
          <defs>
            <filter id="sky-lift" x="-20%" y="-20%" width="160%" height="160%">
              <feDropShadow dx="2" dy="3" stdDeviation="0" floodColor="currentColor" floodOpacity="0.16" />
            </filter>
          </defs>
          <rect
            width={sky.width}
            height={sky.height}
            fill="transparent"
            onClick={() => {
              onSelectRoom(null);
              closeTip();
            }}
          />
          <MapLayers
            ordered={ordered}
            ids={ids}
            camera={camera}
            stats={stats}
            k={k}
            selectedId={selectedId}
            focusId={focusId}
            hoverRoom={hoverRoom}
            onSelectRoom={onSelectRoom}
            onFocusThing={onFocusThing}
            onHoverRoom={setHoverRoom}
            onShowTip={showTip}
            onHideTip={hideTip}
            onCloseTip={closeTip}
          />
        </svg>
        <p id="sky-hint" className="sr-only">화살표로 방을 고르고, 파일은 오른쪽 목록에서 볼 수 있어요.</p>
        {tip && (
          <div
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
      {children}
    </div>
  );
}

// 선·별·방 층. 말풍선 상태를 받지 않으므로, 별 위를 오가도 다시 그리지 않습니다.
const MapLayers = memo(function MapLayers({
  ordered,
  ids,
  camera,
  stats,
  k,
  selectedId,
  focusId,
  hoverRoom,
  onSelectRoom,
  onFocusThing,
  onHoverRoom,
  onShowTip,
  onHideTip,
  onCloseTip,
}: {
  ordered: Node[];
  ids: string[];
  camera: Camera;
  stats: Map<string, RoomStat>;
  k: number;
  selectedId: string | null;
  focusId: string | null;
  hoverRoom: string | null;
  onSelectRoom: (id: string | null) => void;
  onFocusThing: (roomId: string, thingId: string) => void;
  onHoverRoom: (id: string | null) => void;
  onShowTip: (tip: Tip) => void;
  onHideTip: () => void;
  onCloseTip: () => void;
}) {
  const crowded = ordered.length > 12;
  const litId = selectedId ?? hoverRoom;
  // 탭 키로는 지도에 한 번만 들어옵니다. 고른 방이 없으면 첫 방이 들어오는 자리입니다.
  const tabStop = selectedId ?? ids[0];
  // 글자는 CSS가 캔버스 배율만큼 키우니, 원 아래 간격도 같은 비율로 넓힙니다.
  const grow = 1 / Math.max(k, 0.6);

  function onRoomKey(event: KeyboardEvent<SVGGElement>, id: string) {
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
    event.currentTarget.ownerSVGElement?.querySelector<SVGGElement>(`[data-room-id="${CSS.escape(next)}"]`)?.focus();
  }

  return (
    <g className="sky-camera" style={{ transform: camera ? `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` : "none" }}>
      {ordered.map(({ room, at, stars }) => (
        <g key={`links-${room.id}`} className={`links${litId === room.id ? " lit" : ""}`} aria-hidden="true">
          {stars.map((star) => (
            <line key={star.thing.id} x1={at.x} y1={at.y} x2={star.x} y2={star.y} stroke={kindColors[star.thing.kind]} strokeDasharray={star.stage === "fallen" ? "2 6" : "4 4"} />
          ))}
        </g>
      ))}

      {/* 파일 별은 마우스로만 고릅니다. 키보드와 화면 읽기 프로그램은 같은 파일을 오른쪽 목록에서 만납니다. */}
      {ordered.map(({ room, stars }) => (
        <g key={`stars-${room.id}`} className={`cluster${room.care.done ? " ghost" : ""}${selectedId === room.id ? " lifted" : ""}${selectedId && selectedId !== room.id ? " dim" : ""}`} aria-hidden="true">
          {stars.map((star, index) => {
            const size = star.r * 2.6;
            return (
              <g
                key={star.thing.id}
                className={`star stage-${star.stage}${star.thing.id === focusId ? " focused" : ""}`}
                transform={`translate(${star.x} ${star.y})`}
                style={{ "--i": index } as CSSProperties}
                onClick={() => onFocusThing(room.id, star.thing.id)}
                onPointerUp={(event) => {
                  if (event.pointerType !== "mouse") onShowTip({ star, room });
                }}
                onMouseEnter={() => onShowTip({ star, room })}
                onMouseLeave={onHideTip}
              >
                {star.thing.id === focusId && <circle className="pulse" r={size * 0.62} fill="none" stroke={kindColors[star.thing.kind]} strokeWidth="1.5" />}
                <g className="shape" transform={`translate(${-size / 2} ${-size / 2})`}>
                  <ObjectShape kind={star.thing.kind} size={size} />
                </g>
              </g>
            );
          })}
        </g>
      ))}

      {ordered.map(({ room, at, scale, r }) => {
        const { usage } = stats.get(room.id)!;
        const level = budgetLevel(usage, room.budgetBytes);
        const ring = r + 6 * scale;
        const circumference = 2 * Math.PI * ring;
        const ratio = room.budgetBytes && level !== "partial" ? Math.min(1, usage.totalBytes / room.budgetBytes) : 0;
        const done = room.care.done;
        const size = level === "partial" ? `최소 ${formatBytes(usage.totalBytes)}` : room.budgetBytes ? `${formatBytes(usage.totalBytes)} / ${formatBytes(room.budgetBytes)}` : formatBytes(usage.totalBytes);
        // 상태는 새 색 없이 먹색 굵은 글자로 말합니다.
        const warn = done ? "" : level === "near" ? "한도에 거의 참" : level === "over" ? "한도 넘음" : "";
        const labelled = !crowded || !done || room.id === selectedId || room.id === hoverRoom;
        return (
          <g
            key={room.id}
            data-room-id={room.id}
            className={`room-node${done ? " done" : ""}${selectedId === room.id ? " selected" : ""}${selectedId && selectedId !== room.id ? " dim" : ""}`}
            transform={`translate(${at.x} ${at.y})`}
            role="button"
            tabIndex={room.id === tabStop ? 0 : -1}
            aria-pressed={selectedId === room.id}
            aria-label={`${room.name} 방${done ? ", 완료" : ""}, ${size}${warn ? `, ${warn}` : ""}`}
            onClick={() => onSelectRoom(selectedId === room.id ? null : room.id)}
            onKeyDown={(event) => onRoomKey(event, room.id)}
            onMouseEnter={() => onHoverRoom(room.id)}
            onMouseLeave={() => onHoverRoom(null)}
          >
            {ratio > 0 && <circle className={`budget-ring level-${level}`} r={ring} strokeDasharray={`${circumference * ratio} ${circumference}`} transform="rotate(-90)" />}
            <circle className="paper-shadow" cx={5 * scale} cy={7 * scale} r={r} />
            <g className="disc">
              <circle className="body" r={r} stroke="currentColor" strokeWidth={1.4} style={{ fill: "var(--lightbox-1)" }} />
              <circle r={r - 5 * scale} fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2.5 2.5" strokeOpacity="0.35" />
              <text className="room-initial" y={r * 0.34} fill="currentColor" style={{ fontSize: r * 0.95 }}>{[...room.name][0]?.toUpperCase()}</text>
            </g>
            <circle className="focus-ring" r={ring + 4} />
            {labelled && (
              <>
                <text y={ring + (10 + 10 * scale) * grow} className="room-label">{room.name}</text>
                <text y={ring + (27 + 10 * scale) * grow} className="room-sub">
                  {done ? "완료 · " : ""}
                  {size}
                  {warn && <tspan fill="currentColor" fontWeight={700}> · {warn}</tspan>}
                </text>
              </>
            )}
          </g>
        );
      })}
    </g>
  );
});
