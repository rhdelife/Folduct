import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ObjectShape } from "../../art/ObjectShape";
import { kindColors } from "../../art/palette";
import { centerOf, cue, homeActor } from "../useFrodo";
import { namedPaper, type Card, type FindSpot } from "../../domain/heroLayout";
import { formatBytes, kindLabels, type Room } from "../../domain/model";
import { toPx, type View } from "../../domain/sky";
import type { Folder } from "../../gateways/native";
import { usePicture } from "../../storage/pictures";
import { useThumb } from "../../storage/thumbs";

export type Tip = { star: Card; room: Room; anchor: HTMLElement };
const paperBatch = 24;

// 먹인 방의 파일 판: 프로도 아래(넓은 창은 오른쪽)에 스크롤로 놓이는 종이들. 처음엔 움직임이 붙는 만큼만, 더보기 뒤로 나머지를 불러요.
// 마우스로 종이를 위쪽 방 카드에 끌어 놓으면 그 방으로 옮겨요.
// 처음 화면만 먼저 그려요. 목록 끝에 가까워지면 다음 종이 묶음을 준비해요.
export function FedPapers({ cards, find, view, focusId, folder, onOpenThing, onMoveThing, onShowTip, onHideTip, onCloseTip }: {
  cards: Card[];
  find: FindSpot;
  view: View;
  focusId: string | null;
  folder: Folder | null;
  onOpenThing: (roomId: string, thingId: string) => void;
  onMoveThing: ((roomId: string, thingId: string, toRoomId: string) => void) | null;
  onShowTip: (tip: Tip) => void;
  onHideTip: () => void;
  onCloseTip: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(paperBatch);
  // 처음에는 입에서 나오는 움직임이 붙는 종이(첫 화면에 온전히 들어가는 만큼)만 그려요. 아래 종이가 움직임 없이 먼저 떠 보였어요(2026-11-18 요청).
  // 더보기를 누른 뒤부터 나머지를 스크롤에 맞춰 불러와요. 한 장도 안 들어가는 낮은 창은 예전처럼 바로 불러와요.
  const [opened, setOpened] = useState(false);
  const open = opened || find.visible === 0;
  const shown = open ? cards.slice(0, Math.max(count, find.visible)) : cards.slice(0, find.visible);
  const more = shown.length < cards.length;
  const last = shown[shown.length - 1];
  const bottom = toPx(last, view).y - find.filesTop + last.height / 2;
  useEffect(() => {
    const el = end.current;
    if (!open || !more || !el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setCount(shown.length + paperBatch);
    }, { root: scroller.current, rootMargin: "0px 0px 100% 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, more, shown.length]);

  // 손가락이 판을 밀고 지나간 끝에서는 말풍선을 열지 않습니다.
  const pressed = useRef({ x: 0, y: 0 });
  // 마우스로 종이를 끌어 위쪽 방 카드에 놓으면 그 방으로 옮겨요(2026-11-18 요청).
  // 종이 판은 넘치는 부분을 잘라서, 끄는 동안은 화면 위에 띄운 복사본을 움직여요. 손가락은 판 스크롤로 남겨 둬요.
  const drag = useRef<{ pointer: number; x: number; y: number; ghost: HTMLElement | null; to: HTMLElement | null } | null>(null);
  const dragged = useRef(false);
  const dropTarget = (x: number, y: number) => {
    const node = document.elementFromPoint(x, y)?.closest<HTMLElement>(".room-node[data-room-id]") ?? null;
    return node && node.dataset.roomId !== find.room.id ? node : null;
  };
  const onPaperDown = (event: PointerEvent<HTMLDivElement>) => {
    pressed.current = { x: event.clientX, y: event.clientY };
    if (!onMoveThing || event.pointerType !== "mouse" || event.button !== 0 || drag.current) return;
    dragged.current = false;
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, ghost: null, to: null };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPaperMove = (event: PointerEvent<HTMLDivElement>) => {
    const now = drag.current;
    if (!now || event.pointerId !== now.pointer) return;
    const dx = event.clientX - now.x;
    const dy = event.clientY - now.y;
    if (!now.ghost) {
      if (Math.hypot(dx, dy) < 6) return;
      const paper = event.currentTarget.parentElement!;
      const box = paper.getBoundingClientRect();
      const ghost = document.createElement("div");
      ghost.className = "paper-ghost";
      ghost.style.cssText = `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px`;
      ghost.append(event.currentTarget.cloneNode(true));
      document.body.append(ghost);
      now.ghost = ghost;
      event.currentTarget.classList.add("lifted");
      onCloseTip();
    }
    now.ghost.style.translate = `${dx}px ${dy}px`;
    const to = dropTarget(event.clientX, event.clientY);
    if (to !== now.to) {
      now.to?.classList.remove("drop-to");
      to?.classList.add("drop-to");
      now.to = to;
    }
  };
  const onPaperEnd = (event: PointerEvent<HTMLDivElement>, card: Card) => {
    const now = drag.current;
    if (!now || event.pointerId !== now.pointer) return;
    drag.current = null;
    if (!now.ghost) return;
    now.ghost.remove();
    now.to?.classList.remove("drop-to");
    event.currentTarget.classList.remove("lifted");
    // 끈 뒤 따라오는 click 하나는 미리보기로 치지 않아요.
    dragged.current = true;
    setTimeout(() => (dragged.current = false));
    if (event.type === "pointerup" && now.to?.dataset.roomId) onMoveThing?.(card.room.id, card.thing.id, now.to.dataset.roomId);
  };
  const onPaperUp = (event: PointerEvent<HTMLDivElement>, card: Card) => {
    onPaperEnd(event, card);
    if (event.pointerType === "mouse") return;
    if (Math.hypot(event.clientX - pressed.current.x, event.clientY - pressed.current.y) < 10) onShowTip({ star: card, room: card.room, anchor: event.currentTarget });
  };

  return (
    <div
      ref={scroller}
      className="papers"
      role="region"
      aria-label={`${find.room.name} 방 파일`}
      tabIndex={0}
      data-own-wheel
      onScroll={onCloseTip}
      style={{ left: find.left, top: find.filesTop, width: `calc(${find.width}px + var(--space-4))`, height: find.bottom - find.filesTop }}
    >
      <div className="papers-content" style={{ height: !open && more ? `calc(${bottom}px + var(--space-4) + var(--control-sm))` : `calc(${bottom}px + var(--space-2))` }}>
        {shown.map((card, index) => {
          const at = toPx(card, view);
          const focused = card.thing.id === focusId;
          return (
            <div
              key={card.thing.id}
              className={`paper${focused ? " focused" : ""}`}
              data-card={card.thing.id}
              style={{ left: at.x - find.left - card.size / 2, top: at.y - find.filesTop - card.height / 2, width: card.size, height: card.height }}
            >
              <div
                className="paper-art"
                role="button"
                tabIndex={0}
                data-paper={index}
                aria-label={`${card.thing.name}, ${kindLabels[card.thing.kind]}, ${formatBytes(card.thing.size)}`}
                style={{ rotate: `${card.rot}deg` }}
                onClick={() => {
                  if (dragged.current) return;
                  cue(homeActor, { body: "nod" });
                  onOpenThing(card.room.id, card.thing.id);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onOpenThing(card.room.id, card.thing.id);
                }}
                onPointerDown={onPaperDown}
                onPointerMove={onPaperMove}
                onPointerUp={(event) => onPaperUp(event, card)}
                onPointerCancel={(event) => onPaperEnd(event, card)}
                onMouseEnter={(event) => {
                  // 프로도가 종이를 바라봅니다.
                  cue(homeActor, { look: centerOf(event.currentTarget) });
                  onShowTip({ star: card, room: card.room, anchor: event.currentTarget });
                }}
                onMouseLeave={() => {
                  cue(homeActor, { look: null });
                  onHideTip();
                }}
              >
                {focused && <span className="paper-pulse pulse" style={{ borderColor: kindColors[card.thing.kind] }} />}
                <PaperShape card={card} folder={folder} />
              </div>
            </div>
          );
        })}
        {more && open && <div ref={end} className="papers-end" aria-hidden="true" />}
        {more && !open && (
          <button
            type="button"
            className="quiet papers-more"
            style={{ top: `calc(${bottom}px + var(--space-2))` }}
            onClick={() => {
              setOpened(true);
              // 단추가 사라져도 포커스가 판에 남아요.
              scroller.current?.focus({ preventScroll: true });
            }}
          >
            더보기
          </button>
        )}
      </div>
    </div>
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
