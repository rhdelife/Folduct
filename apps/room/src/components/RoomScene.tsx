import { useRef, type ButtonHTMLAttributes, type CSSProperties, type PointerEvent } from "react";
import { ObjectShape } from "../art/ObjectShape";
import { boxColor } from "../art/palette";
import { budgetLevel, objectScale, roomUsage, thingStage } from "../domain/care";
import { formatBytes, kindLabels, type Room, type Spot, type Thing } from "../domain/model";
import { boxSpot, clampSpot, depth, plane, screenDeltaToFloor, toScreen } from "../domain/plane";
import { Icon } from "./Icon";
import { useFitScale } from "./useFitScale";

const keyMoves: Record<string, Spot> = { ArrowRight: { x: 0.25, y: 0 }, ArrowLeft: { x: -0.25, y: 0 }, ArrowUp: { x: 0, y: -0.25 }, ArrowDown: { x: 0, y: 0.25 } };

// 벽에 붙은 물건은 이름표가 판 밖으로 잘리지 않게 위나 벽 쪽으로 붙입니다.
export function tagPlacement(spot: Spot): string | undefined {
  const parts = [spot.y > 8 && "above", spot.x < 1.2 && "start", spot.x > 8.8 && "end"].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}

// 방 안: 빛을 받는 하얀 판 위에 파일 형식별 색의 반투명한 오브제들이 놓입니다. 방은 그림이 아니라 점선 테두리로만 보입니다.
export function RoomScene({
  room,
  now,
  selectedId,
  onSelect,
  onOpen,
  onMove,
  onOpenBox,
  onOpenShelf,
}: {
  room: Room;
  now: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  // 끄는 동안은 화면에서만 움직이고, 놓는 순간(또는 화살표 키) 한 번만 commit=true로 부릅니다.
  onMove: (id: string, spot: Spot, commit: boolean) => void;
  onOpenBox: () => void;
  onOpenShelf: () => void;
}) {
  const [frame, scale] = useFitScale<HTMLDivElement>(plane.width, 1.3);
  const drag = useRef<{ id: string; x: number; y: number; start: Spot; moved: boolean } | null>(null);
  const justDragged = useRef(false);
  const usage = roomUsage(room);
  const level = budgetLevel(usage, room.budgetBytes);
  const fill = level === "partial" || room.budgetBytes === null ? null : Math.min(1, usage.totalBytes / room.budgetBytes);
  const placed = room.things.filter((thing) => thing.spot && !thing.box);
  const shelfCount = room.things.filter((thing) => !thing.spot && !thing.box).length;
  const boxCount = room.things.filter((thing) => thing.box).length;
  const boxAt = toScreen(boxSpot);

  // 끈 거리(판 좌표)를 벽 안쪽 자리로 바꿉니다.
  const dropSpot = (event: PointerEvent, current: NonNullable<typeof drag.current>) => {
    const delta = screenDeltaToFloor((event.clientX - current.x) / scale, (event.clientY - current.y) / scale);
    return clampSpot({ x: current.start.x + delta.x, y: current.start.y + delta.y });
  };
  const cancelDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    drag.current = null;
    event.currentTarget.style.translate = "";
  };

  return (
    <div className="room-frame" ref={frame} style={{ height: plane.height * scale }}>
      <div className="room-plane" style={{ width: plane.width, height: plane.height, transform: `scale(${scale})`, "--s": scale } as CSSProperties}>
        {/* 방 용량만큼 판 아래쪽이 옅게 차오릅니다. 정확한 값은 위쪽 글자로 함께 보여줍니다. */}
        {fill !== null && <div className={`plane-fill level-${level}`} style={{ height: `${fill * 100}%` }} aria-hidden="true" />}
        <p id="plane-hint" className="sr-only">Enter로 고르고, 화살표로 옮겨요. 고른 물건에서 Enter를 한 번 더 누르면 파일을 열어요.</p>
        <button type="button" className="shelf-chip" onClick={onOpenShelf}>선반 · 놓지 않은 물건 {shelfCount}</button>
        {placed.length === 0 && (
          <div className="plane-empty">
            <strong>바닥이 비어 있어요</strong>
            {shelfCount > 0 ? (
              <>
                <span>선반에 파일 {shelfCount}개가 있어요. 골라서 방에 놓아 보세요.</span>
                <button type="button" onClick={onOpenShelf}>선반 열기</button>
              </>
            ) : (
              <span>이 방에 놓을 파일이 아직 없어요.</span>
            )}
          </div>
        )}
        <button type="button" className="box-spot" style={{ left: boxAt.left, top: boxAt.top, zIndex: depth(boxSpot) }} onClick={onOpenBox} aria-label={`정리 상자, ${boxCount}개 들어 있음`}>
          <ObjectShape kind="archive" color={boxColor} size={84} />
          <span className="tag"><b>정리 상자</b><span>{boxCount}개</span></span>
        </button>
        {placed.map((thing) => (
          <ThingObject
            key={thing.id}
            thing={thing}
            stage={thingStage(thing, room.care, room.workDays, now)}
            selected={thing.id === selectedId}
            onPointerDown={(event) => {
              justDragged.current = false;
              if (event.button !== 0) return;
              drag.current = { id: thing.id, x: event.clientX, y: event.clientY, start: thing.spot!, moved: false };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const current = drag.current;
              if (!current || current.id !== thing.id || event.buttons === 0) return;
              if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) / scale < 4) return;
              current.moved = true;
              // 끄는 동안은 React를 다시 그리지 않고 화면에서만 옮깁니다(판 좌표 px, 벽 안쪽으로 잘라서).
              const from = toScreen(current.start);
              const to = toScreen(dropSpot(event, current));
              event.currentTarget.style.translate = `${to.left - from.left}px ${to.top - from.top}px`;
            }}
            onPointerUp={(event) => {
              const current = drag.current;
              drag.current = null;
              if (!current?.moved) return;
              justDragged.current = true;
              onMove(thing.id, dropSpot(event, current), true);
              event.currentTarget.style.translate = "";
            }}
            onPointerCancel={cancelDrag}
            onLostPointerCapture={cancelDrag}
            onClick={() => {
              if (justDragged.current) {
                justDragged.current = false;
                return;
              }
              onSelect(thing.id);
            }}
            onDoubleClick={() => onOpen(thing.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && thing.id === selectedId) {
                event.preventDefault();
                onOpen(thing.id);
                return;
              }
              const move = keyMoves[event.key];
              if (!move) return;
              event.preventDefault();
              onMove(thing.id, clampSpot({ x: thing.spot!.x + move.x, y: thing.spot!.y + move.y }), true);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ThingObject({
  thing,
  stage,
  selected,
  ...handlers
}: {
  thing: Thing;
  stage: { stage: "normal" | "tilted" | "fallen"; days: number };
  selected: boolean;
} & Pick<ButtonHTMLAttributes<HTMLButtonElement>, "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel" | "onLostPointerCapture" | "onClick" | "onDoubleClick" | "onKeyDown">) {
  const at = toScreen(thing.spot!);
  const size = Math.round(60 * objectScale(thing.size));
  const short = thing.missing ? "파일 없음" : stage.stage === "fallen" ? `${stage.days}일 · 쓰러짐` : stage.stage === "tilted" ? `${stage.days}일 · 기울어짐` : null;
  return (
    <button
      type="button"
      className={`thing stage-${stage.stage}${selected ? " selected" : ""}${thing.missing ? " missing" : ""}`}
      style={{ left: at.left, top: at.top, width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, zIndex: depth(thing.spot!) }}
      data-thing-id={thing.id}
      data-tag={tagPlacement(thing.spot!)}
      aria-pressed={selected}
      aria-label={`${thing.name}, ${kindLabels[thing.kind]}, ${formatBytes(thing.size)}${short ? `, ${short}` : ""}${!thing.missing && stage.stage === "fallen" ? ", 다음 정리 때 상자로" : ""}${thing.pinned ? ", 고정됨" : ""}`}
      aria-describedby="plane-hint"
      {...handlers}
    >
      <span className="body">
        <ObjectShape kind={thing.kind} size={size} />
      </span>
      <span className="tag">
        <b>{thing.name}</b>
        <span>
          {thing.pinned && <><Icon name="pin" size={12} /> 고정 · </>}
          {formatBytes(thing.size)}{short && <em> · {short}</em>}
        </span>
      </span>
    </button>
  );
}
