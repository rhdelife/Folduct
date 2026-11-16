import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { ObjectShape, pickArt } from "../art/ObjectShape";
import { colorGroups, kindColors } from "../art/palette";
import { kindParts, kindSummary } from "../art/duct";
import { StackArt } from "./RoomFace";
import { centerOf, cue, homeActor } from "./useFrodo";
import { laneOf, relativeDay, shownActivity } from "../domain/care";
import { fedLengths, heroLayout, namedPaper, type Card, type FedFilter, type FindSpot, type HeroFrodo } from "../domain/heroLayout";
import { formatBytes, kindLabels, type Room, type Thing } from "../domain/model";
import { sky, stepRoom, type RoomStat, type View } from "../domain/sky";
import { faceColorVar } from "../domain/face";
import { roomMenuTriggers, type OpenRoomMenu } from "./ContextMenu";
import { awayFromHome } from "./home/engine";
import { useHeroMotion } from "./home/heroMotion";
import type { Folder } from "../gateways/native";
import { usePicture } from "../storage/pictures";
import { useReadableFolders, useThumb } from "../storage/thumbs";
import { Meta } from "./Meta";
import { faceHex, RoomCover } from "./RoomCover";

type Tip = { star: Card; room: Room };

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
  underFrodo,
  overFrodo,
  paneOpen = false,
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
  // 프로도 받침 바로 아래에 둘 것(작업 시작 줄). 자리는 heroLayout이 startSpace만큼 비워 둬요.
  underFrodo?: ReactNode;
  // 프로도 머리 위에 띄우는 말풍선 자리예요(이번 주 정리).
  overFrodo?: ReactNode;
  // 오른쪽 미리보기 창(--preview-w)이 열리면 넓은 창에서는 판이 그만큼 좁아져(styles.css .pane-open) 왼쪽 폭에만 배치해요.
  paneOpen?: boolean;
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
    // 말풍선은 종이 아래에 열어 위쪽 찾기 칸·형식 단추를 가리지 않아요. 아래 자리가 모자랄 때만 위로 올려요.
    el.classList.remove("above");
    const area = el.closest(".sky-layout")!.getBoundingClientRect();
    if (el.getBoundingClientRect().bottom > Math.min(area.bottom, window.innerHeight)) el.classList.add("above");
    const box = el.getBoundingClientRect();
    const open = (document.querySelector(".sky-panel.open") ?? (document.querySelector(".sky-canvas.pane-open") && document.querySelector(".preview-pane")))?.getBoundingClientRect();
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

  // 먹은 방에서 찾는 말과 고른 형식(색 띠 이름). 다른 방을 먹이면 처음부터예요.
  const [finding, setFinding] = useState<{ room: string | null; query: string; label: string | null }>({ room: null, query: "", label: null });
  const own = finding.room === selectedId;
  const query = own ? finding.query : "";
  const label = own ? finding.label : null;
  const filter = useMemo<FedFilter>(() => ({ query, kinds: colorGroups.find((group) => group.label === label)?.kinds ?? null }), [query, label]);
  const onFind = useCallback((patch: { query?: string; label?: string | null }) => setFinding((old) => ({ ...(old.room === selectedId ? old : { query: "", label: null }), room: selectedId, ...patch })), [selectedId]);
  // 종이 위에 마우스를 올려도 배치는 다시 계산하지 않습니다.
  const { shelf, rooms: shelfRooms, frodo, cards, find } = useMemo(() => heroLayout(rooms, now, view, paperAspect, doorOpen, selectedId, filter), [rooms, selectedId, now, view, doorOpen, filter]);
  const ids = useMemo(() => shelfRooms.map((room) => room.id), [shelfRooms]);
  const feed = onSelectRoom;

  // 현관에 새 파일이 오면 고개를 들어 그쪽을 봅니다.
  useEffect(() => {
    if (doorOpen) cue(homeActor, { face: "lookU", ms: 1200 });
  }, [doorOpen]);

  // 평소에는 프로도만 보입니다. 먹은 방의 파일만 입에서 나와요.
  useHeroMotion(canvas, cards, frodo, view, selectedId);

  // 화살표로 방 카드 사이를 옮겨 다니면 프로도가 그 방을 먹고 파일을 뱉어요.
  const step = useRef<(key: string) => void>(() => {});
  step.current = (key) => {
    const next = stepRoom(ids, selectedId, key);
    if (!next || next === selectedId) return;
    closeTip();
    feed(next);
    // Enter를 한 번 더 누르면 그 방으로 들어가도록 포커스도 따라갑니다.
    canvas.current?.querySelector<HTMLElement>(`.room-node[data-room-id="${CSS.escape(next)}"]`)?.focus({ preventScroll: true });
  };
  useEffect(() => {
    // 대화상자·메뉴가 떠 있거나, 글을 쓰는 중이거나, 옆으로 미는 현관 줄 위에서는 건드리지 않아요.
    // 아래 형식별 칸으로 내려가 있을 때도 건드리지 않아요. 그때 화살표와 휠은 페이지를 움직여요.
    const blocked = (target: EventTarget | null) => awayFromHome() || document.querySelector("dialog[open], .context-menu") !== null || (target instanceof Element && target.closest("input, textarea, select, [contenteditable], .doorstep") !== null);
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || !keys.includes(event.key) || blocked(event.target)) return;
      event.preventDefault();
      step.current(event.key);
    };
    // 좌우로 쓸거나 Shift+휠로는 방을 바꾸지 않아요. 파일을 보다가 손이 조금만 옆으로 흘러도 다른 방으로 넘어갔어요.
    // 방은 카드를 누르거나 끌어 놓거나 화살표로만 바꿔요. 세로 휠은 페이지를 아래 형식별 칸으로 내려요.
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // 주름관이 사라지면 mouseleave가 오지 않으니, 지도에서 빠진 방의 강조와 말풍선은 여기서 지웁니다.
  if (tip && !ids.includes(tip.room.id)) setTip(null);

  // 말풍선은 별 자리에 둡니다. 판 가장자리에서는 안쪽으로 당기고, 위쪽 별은 아래로 뒤집습니다.
  const tipX = tip ? tip.star.x : 0;
  const tipY = tip ? tip.star.y : 0;

  return (
      <div className={`sky-canvas${selectedId ? " has-selection" : ""}${paneOpen ? " pane-open" : ""}`} ref={canvas}>
        <div
          className="sky-backdrop"
          onClick={() => {
            feed(null);
            closeTip();
          }}
        />
        <MapLayers
          shelf={shelf}
          rooms={shelfRooms}
          frodo={frodo}
          cards={cards}
          find={find}
          query={query}
          label={label}
          onFind={onFind}
          ids={ids}
          stats={stats}
          selectedId={selectedId}
          focusId={focusId}
          onFeed={feed}
          onOpenRoom={onOpenRoom}
          onFocusThing={onFocusThing}
          onOpenThing={onOpenThing}
          onRoomMenu={onRoomMenu}
          onShowTip={showTip}
          onHideTip={hideTip}
          onCloseTip={closeTip}
        />
        {frodo && underFrodo && <div className="under-frodo" style={{ left: frodo.left + frodo.width / 2, top: frodo.floor }}>{underFrodo}</div>}
        {frodo && overFrodo && <div className="over-frodo" style={{ left: frodo.left + frodo.width / 2, top: frodo.top }}>{overFrodo}</div>}
        <p id="sky-hint" className="sr-only">방 카드를 프로도에게 끌어다 놓거나 누르면 프로도가 그 방을 먹고 그 방 파일을 보여 줘요. 화살표로 다른 방을 먹일 수 있어요. 먹은 방 카드를 한 번 더 누르면 방으로 들어가요. Esc로 돌아오고, 메뉴 키로는 방 설정을 열 수 있어요. 아래로 내리면 형식별로 볼 수 있어요.</p>
        {tip && (
          <div
            ref={tipBox}
            className="sky-tip"
            aria-hidden="true"
            style={{ left: `${(Math.min(880, Math.max(120, tipX)) / sky.width) * 100}%`, top: `${(tipY / sky.height) * 100}%`, "--half": `${tip.star.height / 2}px` } as CSSProperties}
            onMouseEnter={() => clearTimeout(closeTimer.current)}
            onMouseLeave={hideTip}
          >
            <strong>{tip.star.thing.name}</strong>
            <Meta items={[tip.room.name, kindLabels[tip.star.thing.kind], formatBytes(tip.star.thing.size)]} />
            <span>{relativeDay(shownActivity(tip.star.thing, tip.room), now)} 작업</span>
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
  shelf,
  rooms,
  frodo,
  cards,
  find,
  query,
  label,
  onFind,
  ids,
  stats,
  selectedId,
  focusId,
  onFeed,
  onOpenRoom,
  onFocusThing,
  onOpenThing,
  onRoomMenu,
  onShowTip,
  onHideTip,
  onCloseTip,
}: {
  shelf: { top: number; height: number } | null;
  rooms: Room[];
  frodo: HeroFrodo | null;
  cards: Card[];
  find: FindSpot | null;
  query: string;
  label: string | null;
  onFind: (patch: { query?: string; label?: string | null }) => void;
  ids: string[];
  stats: Map<string, RoomStat>;
  selectedId: string | null;
  focusId: string | null;
  onFeed: (id: string | null) => void;
  onOpenRoom: (id: string) => void;
  onFocusThing: (roomId: string, thingId: string) => void;
  onOpenThing: (roomId: string, thingId: string) => void;
  onRoomMenu: OpenRoomMenu;
  onShowTip: (tip: Tip) => void;
  onHideTip: () => void;
  onCloseTip: () => void;
}) {
  // 탭 키로는 카드 줄에 한 번만 들어옵니다. 먹은 방이 없으면 첫 방이 들어오는 자리입니다.
  const [lastFocus, setLastFocus] = useState<string | null>(null);
  const tabStop = selectedId ?? (lastFocus && ids.includes(lastFocus) ? lastFocus : ids[0]);

  function onRoomKey(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    // 서랍장 장면에서는 화면 밖 카드에 남은 포커스가 방을 먹이거나 페이지를 끌어올리지 않아요.
    if (awayFromHome()) {
      if (event.key === "Enter" || event.key === " ") event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      onFeed(null);
      onCloseTip();
      return;
    }
    const next = stepRoom(ids, id, event.key);
    if (!next) return;
    event.preventDefault();
    const card = event.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-room-id="${CSS.escape(next)}"]`);
    card?.focus();
    // 옮겨 간 방을 프로도가 먹어요.
    onFeed(next);
  }

  // 처음 누르면 프로도가 그 방을 먹고 파일을 뱉고, 먹은 방 카드를 한 번 더 누르면 방으로 들어갑니다.
  const pick = (id: string) => (id === selectedId ? onOpenRoom(id) : onFeed(id));

  // 카드 끌기. 프로도 위에 놓으면 먹이고, 다른 데 놓으면 제자리로 돌아가요. 6px 넘게 움직여야 끌기로 봐서 그냥 누르기와 섞이지 않아요.
  const drag = useRef<{ id: string; pointer: number; x: number; y: number; moved: boolean; over: boolean; eyed: number } | null>(null);
  const dragged = useRef(false);
  const overFrodo = (el: Element, x: number, y: number) => {
    if (!frodo) return false;
    const box = el.closest(".sky-canvas")!.getBoundingClientRect();
    const reach = 24;
    return x - box.left > frodo.left - reach && x - box.left < frodo.left + frodo.width + reach && y - box.top > frodo.top - reach && y - box.top < frodo.floor + reach;
  };
  function onCardDown(event: PointerEvent<HTMLButtonElement>, id: string) {
    // 두 번째 손가락은 무시해요. 끌던 카드가 중간에 멈춰 버려요.
    if (event.button !== 0 || awayFromHome() || drag.current) return;
    dragged.current = false;
    drag.current = { id, pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false, over: false, eyed: 0 };
    // 누르자마자 잡아 둬요. 빨리 끌면 첫 움직임부터 카드 밖이라 카드가 움직임을 못 받았어요.
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onCardMove(event: PointerEvent<HTMLButtonElement>) {
    const now = drag.current;
    if (!now || event.pointerId !== now.pointer) return;
    const dx = event.clientX - now.x;
    const dy = event.clientY - now.y;
    const el = event.currentTarget;
    if (!now.moved) {
      if (Math.hypot(dx, dy) < 6) return;
      now.moved = true;
      el.classList.add("dragging");
      onCloseTip();
    }
    el.style.translate = `${dx}px ${dy}px`;
    now.over = overFrodo(el, event.clientX, event.clientY);
    el.closest(".sky-canvas")?.classList.toggle("feed-over", now.over);
    // 프로도는 끌려오는 카드를 보고, 위에 오면 입을 크게 벌려요.
    if (event.timeStamp - now.eyed > 160) {
      now.eyed = event.timeStamp;
      cue(homeActor, now.over ? { face: "wide", ms: 400 } : { look: { x: event.clientX, y: event.clientY } });
    }
  }
  function onCardUp(event: PointerEvent<HTMLButtonElement>) {
    const now = drag.current;
    if (!now || event.pointerId !== now.pointer) return;
    drag.current = null;
    if (!now.moved) return;
    // 끈 뒤 바로 따라오는 click 하나만 누르기로 치지 않아요. 취소(pointercancel)에는 click이 오지 않으니 표시하지 않고, 남은 표시는 다음 틱에 지워요.
    if (event.type === "pointerup") {
      dragged.current = true;
      setTimeout(() => (dragged.current = false));
    }
    const el = event.currentTarget;
    const at = el.style.translate;
    el.style.translate = "";
    el.classList.remove("dragging");
    el.closest(".sky-canvas")?.classList.remove("feed-over");
    cue(homeActor, { look: null });
    if (event.type === "pointerup" && now.over) {
      if (now.id !== selectedId) onFeed(now.id);
      return;
    }
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) el.animate([{ translate: at }, { translate: "0px 0px" }], { duration: 260, easing: "cubic-bezier(.2,.8,.3,1)" });
  }

  const folders = useReadableFolders(rooms);
  const picked = rooms.find((room) => room.id === selectedId);
  const lengths = useMemo(() => fedLengths(picked), [picked]);
  // 다 세지 못한 방(읽지 못한 파일이 있거나 아직 세는 중)도 센 파일만으로 색을 칠해요. 큰 방일수록 그런 경우가 많아 색이 안 차 보였어요.
  const parts = useMemo(() => (picked ? kindParts(picked.things) : []), [picked]);
  // 먹은 방의 형식별 비율 전부. 색 띠 이름표를 못 보는 화면 읽기·키보드 사용자는 먹은 카드 이름표에서 들어요.
  const shares = useMemo(() => {
    const total = parts.reduce((sum, item) => sum + item.size, 0);
    return [...parts].sort((a, b) => b.size - a.size).map((item) => `${item.label} ${Math.round((item.size / total) * 100)}%`).join(", ");
  }, [parts]);
  // 몸의 색 띠 위에 올리면 그 형식이 몇 퍼센트인지 작은 이름표로 보여 줘요. 같은 비율은 방 카드의 화면 읽기 이름표에도 있어요.
  const [bandTip, setBandTip] = useState<{ room: string; x: number; y: number; text: string } | null>(null);
  const showBand = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    // 아직 차오르지 않은 색은 가림에 잘려 가리켜지지 않아요.
    const part = target.classList.contains("feed-band") ? parts.find((item) => item.color === target.getAttribute("fill")) : undefined;
    if (!part || !picked) return setBandTip(null);
    const total = parts.reduce((sum, item) => sum + item.size, 0);
    const share = Math.round((part.size / total) * 100);
    const box = event.currentTarget.closest(".sky-canvas")!.getBoundingClientRect();
    setBandTip({ room: picked.id, x: event.clientX - box.left, y: event.clientY - box.top, text: `${part.label} ${share < 1 ? "1% 미만" : `${share}%`} · ${formatBytes(part.size)}` });
  };
  // 색 띠를 누르면 그 형식 파일만 남겨요. 한 번 더 누르면 다시 다 보여요.
  const pickBand = (event: { target: EventTarget }) => {
    const target = event.target as Element;
    const part = target.classList.contains("feed-band") ? parts.find((item) => item.color === target.getAttribute("fill")) : undefined;
    if (part) onFind({ label: label === part.label ? null : part.label });
  };
  // 손가락이 판을 밀고 지나간 끝에서는 말풍선을 열지 않습니다.
  const pressed = useRef({ x: 0, y: 0 });
  const onPaperUp = (event: PointerEvent, card: Card) => {
    if (event.pointerType === "mouse") return;
    if (Math.hypot(event.clientX - pressed.current.x, event.clientY - pressed.current.y) < 10) onShowTip({ star: card, room: card.room });
  };

  return (
    <div className="sky-camera">
      {/* 먹은 방 종이는 단추예요. Tab으로 하나씩, 찾기 칸에서 ↓로 맨 앞 종이로 가요. 장면 순서(프로도가 종이 위) 때문에 DOM은 방 카드보다 앞이에요. */}
      <div className="papers" role="group" aria-label={picked ? `${picked.name} 방 파일` : undefined}>
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
                role="button"
                tabIndex={0}
                data-paper={index}
                aria-label={`${card.thing.name}, ${kindLabels[card.thing.kind]}, ${formatBytes(card.thing.size)}`}
                style={{ rotate: `${card.rot}deg` }}
                onClick={() => {
                  cue(homeActor, { body: "nod" });
                  onOpenThing(card.room.id, card.thing.id);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onOpenThing(card.room.id, card.thing.id);
                }}
                onPointerDown={(event) => (pressed.current = { x: event.clientX, y: event.clientY })}
                onPointerUp={(event) => onPaperUp(event, card)}
                onMouseEnter={(event) => {
                  // 프로도가 종이를 바라봅니다.
                  cue(homeActor, { look: centerOf(event.currentTarget) });
                  onShowTip({ star: card, room: card.room });
                }}
                onMouseLeave={() => {
                  cue(homeActor, { look: null });
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
      <div className="sky-rooms">
        {frodo && (
          <div className="frodo-home" aria-hidden="true" style={{ left: frodo.left, top: frodo.top, width: frodo.width, height: frodo.height }} onPointerMove={showBand} onPointerDown={showBand} onPointerLeave={() => setBandTip(null)} onClick={pickBand}>
            <span className="frodo-clip">
            <span className="frodo-lift">
              <span className="vase-float">
                <StackArt key={picked?.id ?? "hungry"} lengths={lengths} parts={parts} px={Math.round(frodo.width / 8) * 8} foot={picked ? faceColorVar(picked.face.color) : undefined} className="vase-art" actor={homeActor} mood={picked ? "happy" : "base"} />
              </span>
            </span>
            </span>
          </div>
        )}
        {bandTip && bandTip.room === picked?.id && <p className="band-tip" aria-hidden="true" style={{ left: bandTip.x, top: bandTip.y }}>{bandTip.text}</p>}
        {shelf && (
          <div className="room-shelf" role="group" aria-label="내 방들. 방 카드를 프로도에게 끌어다 놓거나 누르면 프로도가 그 방을 먹고, 그 방 용량만큼 길어지며 그 방 파일을 보여 줘요." aria-describedby="sky-hint" style={{ top: shelf.top, height: shelf.height, "--n": rooms.length } as CSSProperties}>
            {rooms.map((room) => {
              const { usage, stale } = stats.get(room.id)!;
              const parts = kindParts(room.things);
              const size = `${usage.exact ? "" : "최소 "}${formatBytes(usage.totalBytes)}`;
              const menu = roomMenuTriggers(room.id, onRoomMenu);
              const fed = selectedId === room.id;
              return (
                // 카드 하나 = 방 카드 단추 + 옆의 ⋯ 단추. 단추 안에 단추를 둘 수 없어서 둘을 한 칸에 겹쳐 놓아요.
                <div key={room.id} className="room-slot">
                <button
                  type="button"
                  data-room-id={room.id}
                  className={`room-node${fed ? " fed" : ""}`}
                  style={{ "--room-color": faceColorVar(room.face.color) } as CSSProperties}
                  tabIndex={room.id === tabStop ? 0 : -1}
                  aria-pressed={fed}
                  aria-label={`${room.name} 방, ${size}${stale > 0 ? `, 안 쓴 파일 ${stale}개` : ""}${parts.length ? `, ${kindSummary(parts)}` : ""}${fed ? `. 프로도가 먹었어요${shares ? `: ${shares}` : ""}. 한 번 더 누르면 방으로 들어가요` : ""}`}
                  onClick={(event) => {
                    if (dragged.current) {
                      dragged.current = false;
                      return;
                    }
                    pick(room.id);
                  }}
                  onPointerDown={(event) => onCardDown(event, room.id)}
                  onPointerMove={onCardMove}
                  onPointerUp={onCardUp}
                  onPointerCancel={onCardUp}
                  onContextMenu={(event) => {
                    cue(homeActor, { body: "tilt", face: "tilt", ms: 720 });
                    menu.onContextMenu(event);
                  }}
                  onFocus={(event) => {
                    setLastFocus(room.id);
                    if (event.currentTarget.matches(":focus-visible")) cue(homeActor, { look: centerOf(event.currentTarget) });
                  }}
                  onKeyDown={(event) => {
                    menu.onKeyDown(event);
                    onRoomKey(event, room.id);
                  }}
                  onMouseEnter={(event) => cue(homeActor, { look: centerOf(event.currentTarget) })}
                  onMouseLeave={() => cue(homeActor, { look: null })}
                >
                  <RoomCover room={room} folder={folders.get(room.id) ?? null} px={64} color={faceHex(room.face.color)} />
                  <span className="room-label">{room.name}</span>
                  <Meta className="room-sub" items={[size, stale > 0 && <b>안 쓴 파일 {stale}개</b>]} />
                </button>
                {/* 오른쪽 클릭으로만 열리던 방 메뉴(방 설정·홈에서 빼기)를 보이는 단추로도 열어요. */}
                <button
                  type="button"
                  className="room-more quiet"
                  aria-label={`${room.name} 방 메뉴`}
                  aria-haspopup="menu"
                  tabIndex={room.id === tabStop ? 0 : -1}
                  onClick={(event) => {
                    const box = event.currentTarget.getBoundingClientRect();
                    onRoomMenu(room.id, event.currentTarget, box.left, box.bottom);
                  }}
                >
                  ⋯
                </button>
                </div>
              );
            })}
          </div>
        )}
        {/* 먹은 방 파일 칸 맨 위의 찾기 줄. 이름·폴더로 찾거나 형식 하나만 남겨요. Enter는 맨 앞 파일을 열어요. */}
        {find && (
          <div className="fed-find" style={{ left: find.left, top: find.top, width: find.width }}>
            <input
              type="search"
              className="fed-search"
              value={query}
              placeholder="이름이나 폴더로 찾기"
              aria-label={`${find.room.name} 방에서 파일 이름이나 폴더 이름으로 찾기. Enter를 누르면 맨 앞 파일을 열고, 아래 화살표로 파일로 가요.`}
              onChange={(event) => onFind({ query: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter" && cards[0]) {
                  event.preventDefault();
                  onOpenThing(find.room.id, cards[0].thing.id);
                }
                if (event.key === "ArrowDown" && cards[0]) {
                  event.preventDefault();
                  event.currentTarget.closest(".sky-camera")?.querySelector<HTMLElement>('[data-paper="0"]')?.focus();
                }
                // 찾는 말이 있으면 Esc는 말만 지우고, 프로도는 그대로 둬요.
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  event.stopPropagation();
                  onFind({ query: "" });
                }
              }}
            />
            {parts.length > 1 && (
              <div className="fed-kinds" role="group" aria-label="형식으로 좁히기">
                {parts.map((part) => (
                  <button key={part.label} type="button" className="fed-kind" aria-pressed={label === part.label} onClick={() => onFind({ label: label === part.label ? null : part.label })}>
                    <span className="fed-dot" style={{ background: part.color }} aria-hidden="true" />
                    {part.label}
                  </button>
                ))}
              </div>
            )}
            <span className="fed-count" role="status">
              {find.found === 0 ? "맞는 파일이 없어요" : cards.length < find.found ? `${find.found.toLocaleString("ko-KR")}개 중 ${cards.length}개` : `${find.found.toLocaleString("ko-KR")}개`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
});

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
