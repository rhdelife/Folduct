import { useRef, type ButtonHTMLAttributes, type CSSProperties, type PointerEvent } from "react";
import { ObjectShape, pickArt } from "../art/ObjectShape";
import { boxColor, tonesFrom } from "../art/palette";
import { objectScale } from "../domain/care";
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

// 모눈은 판 좌표로 긋고 non-scaling-stroke로 어떤 배율에서도 한 기기 픽셀을 지킵니다. 판 안쪽으로 한 칸(20) 여백을 둡니다.
const gridStep = 20;
const gridPath = [
  ...Array.from({ length: plane.width / gridStep - 1 }, (_, at) => `M${(at + 1) * gridStep} ${gridStep}V${plane.height - gridStep}`),
  ...Array.from({ length: plane.height / gridStep - 1 }, (_, at) => `M${gridStep} ${(at + 1) * gridStep}H${plane.width - gridStep}`),
].join("");

export function GridPaper() {
  return (
    <svg className="grid-paper" viewBox={`0 0 ${plane.width} ${plane.height}`} aria-hidden="true" focusable="false">
      <path d={gridPath} />
    </svg>
  );
}

const boxTones = tonesFrom(boxColor);
// 상자에 든 종이는 위로 조금 삐져나옵니다. 앞판이 종이를 가려서 상자 안에 든 것처럼 보여요.
const peeks = [{ left: "16%", rotate: "-8deg" }, { left: "42%", rotate: "6deg" }, { left: "29%", rotate: "-2deg" }];

// 정리 상자: 윗날개가 열린 문서 보관 상자. 색은 파일 형식이 아니라 상자 몫의 회색(palette.ts) 한 벌입니다.
export function CardboardBox({ things }: { things: Thing[] }) {
  return (
    <span className="cardboard" aria-hidden="true">
      <svg viewBox="0 0 100 100" focusable="false">
        <path d="M18 38L28 20H72L82 38Z" fill={boxTones.soft} />
        <path d="M18 38H82V60H18Z" fill={boxTones.edge} />
      </svg>
      {things.slice(-peeks.length).map((thing, at) => (
        <span key={thing.id} className="cardboard-peek" style={peeks[at]}><ObjectShape kind={thing.kind} size={38} seed={thing.id} /></span>
      ))}
      <svg viewBox="0 0 100 100" focusable="false">
        <path d="M18 38L3 31L8 50L18 56Z" fill={boxTones.soft} />
        <path d="M82 38L97 31L92 50L82 56Z" fill={boxTones.soft} />
        <path d="M18 52H82V98H18Z" fill={boxTones.pale} />
        <path d="M40 60H60Q63 60 63 63Q63 66 60 66H40Q37 66 37 63Q37 60 40 60Z" fill={boxTones.edge} />
        <path d="M31 74H69V90H31Z" fill="var(--bg)" />
        <path d="M37 80H63M37 85H54" stroke={boxTones.soft} strokeWidth="1.5" />
      </svg>
    </span>
  );
}

// 방 안: 모눈종이 한 장 위에 파일 종이들이 놓입니다.
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
  // 휴대폰 폭에서도 0.55배 밑으로는 줄이지 않습니다(물건 이름이 읽히는 한계). styles.css의 clamp(0.55, …)와 같은 값이에요.
  const [frame, scale] = useFitScale<HTMLDivElement>(plane.width, 1.3, 0.55);
  const drag = useRef<{ id: string; x: number; y: number; start: Spot; moved: boolean } | null>(null);
  const justDragged = useRef(false);
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
        <GridPaper />
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
          <CardboardBox things={room.things.filter((thing) => thing.box)} />
          <span className="tag"><b>정리 상자</b><span>{boxCount}개</span></span>
        </button>
        {placed.map((thing, order) => (
          <ThingObject
            key={thing.id}
            thing={thing}
            order={order}
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
  order,
  selected,
  ...handlers
}: {
  thing: Thing;
  order: number;
  selected: boolean;
} & Pick<ButtonHTMLAttributes<HTMLButtonElement>, "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel" | "onLostPointerCapture" | "onClick" | "onDoubleClick" | "onKeyDown">) {
  const at = toScreen(thing.spot!);
  const size = Math.round(60 * objectScale(thing.size));
  // 종이마다 비율이 달라요. 버튼을 종이에 꼭 맞춰야 이름표와 포커스 테두리가 종이에 붙습니다.
  const art = pickArt(thing.kind, thing.id);
  const height = Math.round((size * art.h) / art.w);
  // 종이마다 아주 살짝 다르게 놓입니다(상태와 헷갈리지 않을 만큼만).
  const lean = ((thing.id.charCodeAt(0) + thing.id.charCodeAt(thing.id.length - 1)) % 5) - 2;
  const short = thing.missing ? "파일 없음" : null;
  return (
    <button
      type="button"
      className={`thing${selected ? " selected" : ""}${thing.missing ? " missing" : ""}`}
      style={{ left: at.left, top: at.top, width: size, height, marginLeft: -size / 2, marginTop: -height / 2, zIndex: depth(thing.spot!) }}
      data-thing-id={thing.id}
      data-tag={tagPlacement(thing.spot!)}
      aria-pressed={selected}
      aria-label={`${thing.name}, ${kindLabels[thing.kind]}, ${formatBytes(thing.size)}${short ? `, ${short}` : ""}${thing.pinned ? ", 고정됨" : ""}`}
      aria-describedby="plane-hint"
      {...handlers}
    >
      <span className="body" style={{ left: 0, top: 0, width: size, height, rotate: `${lean}deg`, "--i": Math.min(order, 16) } as CSSProperties}>
        <ObjectShape kind={thing.kind} size={size} name={thing.name} seed={thing.id} />
      </span>
      {/* 고른 물건에는 연필로 동그라미를 칩니다. 그림자 대신이에요. */}
      {selected && (
        <svg className="hand-ring" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path d="M20 12C42 0 82 2 94 30C104 58 84 92 50 96C18 100 0 74 4 44C7 24 26 6 60 5" />
        </svg>
      )}
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
