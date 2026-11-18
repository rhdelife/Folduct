import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { ObjectShape } from "../../art/ObjectShape";
import { colorGroups } from "../../art/palette";
import { formatBytes, type Room } from "../../domain/model";
import { hueColors } from "../../domain/hue";
import { drawerShelves, hueShelves, kindShelves, needsSeconds, secondsKey, shelfItems, sizeShelves, unreadHueShelf, videoLengthShelves, type Shelf, type ShelfItem } from "../../domain/shelves";
import { useVideoSeconds } from "../../storage/durations";
import type { Folder } from "../../gateways/native";
import { usePicture } from "../../storage/pictures";
import { useHuesOf, useReadableFolders, useThumb } from "../../storage/thumbs";
import { Meta } from "../Meta";
import { awayFromHome } from "./engine";
import { cssToken, tokenMs } from "../tokens";
import { Icon } from "../Icon";
import { builtInShelfViews, emptyShelfViews, reservedViewNames, uniqueName, type Drawer as DrawerSpec, type ShelfViews } from "../../domain/shelfViews";
import { getShelfViews, saveShelfViews } from "../../storage/shelfViews";
import { ShelfEditor } from "./ShelfEditor";
import { isNotFound, restoreTrashed, trashFile } from "../../gateways/mover";
import type { ToastAction } from "../Toast";
import { isNative } from "../../gateways/native";
import { patchRoom } from "../../storage/db";

// 목록 종이는 이만큼씩 놓고, 끝에 가까이 내려가면 다음 묶음을 더 놓아요(무한 스크롤, 2026-11-17 요청). 파일 수백 개짜리 방도 처음엔 가벼워요.
const shownStep = 24;
// 열린 서랍 안에 앞뒤로 겹쳐 꽂힌 종이 수.
const peekCount = 5;
const cardArtPx = 40;
const slipId = "kind-slip";

// 형식 서랍은 형식 색, 컬러별 서랍은 그 색 네모(HueSwatches와 같은 --hue-*)예요.
// 사용자가 만든 서랍은 고른 형식 중 첫 형식의 색이에요.
const colorOf = (shelf: Shelf) => shelf.hue
  ? hueColors[shelf.hue]
  : colorGroups.find((group) => group.kinds.includes(shelf.kinds[0]))?.color ?? "var(--surface-sunken)";
const countText = (count: number) => count.toLocaleString("ko-KR");
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// 홈 아래 한 장면: 홈에 둔 방들의 파일을 형식마다 서랍 하나에 나눠 담은 서랍장이에요.
// 서랍을 누르면 앞으로 빠져나오며 안의 종이가 튀어 오르고, 나머지 서랍은 흐려지고, 옆에 그 서랍의 목록 종이가 펼쳐져요. 한 번에 한 서랍만 열려요.
// 주름관은 방 하나만 뜻해서 여기에는 쓰지 않아요. 색은 형식 색만 써요.
// onListGone: 열려 있던 목록 종이가 닫히거나 다른 서랍 목록으로 바뀌면 불러요. 그 목록에서 연 미리보기 창도 같이 닫으려고요.
export const KindShelf = forwardRef<HTMLElement, { rooms: Room[]; onOpenFile: (roomId: string, thingId: string) => void; onListGone?: () => void; onTrashed?: (message: string, undo?: ToastAction) => void }>(function KindShelf({ rooms, onOpenFile, onListGone, onTrashed }, ref) {
  // 기본 분류 또는 저장한 서랍장의 id예요.
  const [mode, setMode] = useState<string>("kind");
  const [views, setViews] = useState<ShelfViews>(emptyShelfViews);
  useEffect(() => {
    getShelfViews().then(setViews, (error: unknown) => console.error(error));
  }, []);
  // 서랍장 고치기 창: 지금 서랍장을 고치거나(edit) 새 서랍장을 만들어요(new).
  const [editing, setEditing] = useState<"edit" | "new" | null>(null);
  const customView = views.custom.find((view) => view.id === mode);
  const drawers = mode === "kind" ? views.kind : customView?.drawers;
  const items = useMemo(() => shelfItems(rooms), [rooms]);
  const folders = useReadableFolders(rooms.filter((room) => !room.care.done));
  // 영상 길이 조건이 있는 서랍장을 볼 때만 길이를 읽어요.
  const byLength = mode === "video-length";
  const colorKind = mode === "hue" ? "image" : mode === "video-hue" ? "video" : null;
  const { seconds, version } = useVideoSeconds(items, folders, byLength || Boolean(drawers && needsSeconds(drawers)) || editing !== null);
  const kinds = useMemo(() => (drawers ? drawerShelves(rooms, drawers, seconds) : kindShelves(rooms, colorGroups)), [rooms, drawers, seconds, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const readable = useMemo(() => items.flatMap(({ room, thing }) => (folders.has(room.id) ? [{ folder: folders.get(room.id)!, thing }] : [])), [items, folders]);
  const { hues, total: colorTotal } = useHuesOf(readable, colorKind !== null, colorKind ?? "image");
  let shelves = kinds;
  let note = "";
  if (colorKind) {
    const found = new Map(hues);
    for (const { room, thing } of items) {
      if (thing.kind === colorKind && !folders.has(room.id)) found.set(thing.id, null);
    }
    shelves = [...hueShelves(items, found, colorKind), ...unreadHueShelf(items, found, colorKind)];
    if (hues.size < colorTotal) note = `색을 읽는 중 ${countText(hues.size)}/${countText(colorTotal)}`;
    else if (!shelves.length) note = colorKind === "image" ? "분류할 이미지가 없어요." : "분류할 영상이 없어요.";
    else if (colorTotal === 0) note = "색을 읽으려면 실제 파일이 있는 폴더를 연결해 주세요.";
  } else if (byLength) {
    const lengths = new Map<string, number | null>();
    let total = 0;
    let finished = 0;
    for (const item of items) {
      if (item.thing.kind !== "video") continue;
      const key = secondsKey(item);
      if (!folders.has(item.room.id)) lengths.set(key, null);
      else {
        total++;
        if (seconds.has(key)) {
          finished++;
          lengths.set(key, seconds.get(key) ?? null);
        }
      }
    }
    shelves = videoLengthShelves(items, lengths);
    if (finished < total) note = `영상 길이를 읽는 중 ${countText(finished)}/${countText(total)}`;
    else if (!shelves.length) note = "분류할 영상이 없어요.";
    else if (total === 0) note = "재생 시간을 읽으려면 실제 파일이 있는 폴더를 연결해 주세요.";
  } else if (mode === "size") {
    shelves = sizeShelves(items);
    if (!shelves.length) note = "분류할 파일이 없어요.";
  } else if (!shelves.length) {
    note = "이 서랍장에 보일 파일이 없어요. 편집에서 서랍 조건을 골라 주세요.";
  }
  const [open, setOpen] = useState<string | null>(null);
  // 닫히는 동안에도 목록 종이가 빈 채로 빠지지 않게 마지막으로 연 서랍을 붙들어 둬요.
  const [last, setLast] = useState<string | null>(null);
  // 닫히기 시작한 서랍들이에요. 들어가는 동안 새로 연 서랍 아래에 두고, 바로 다른 서랍으로 바꿔 열었으면(swap) 그 목록 종이도 새 종이 밑에서 사라질 때까지 남겨 둬요.
  // 빠르게 여러 번 바꿔도 서랍마다 따로 붙들어서, 먼저 닫힌 서랍과 종이가 한 프레임에 사라지지 않아요.
  const [gone, setGone] = useState<{ label: string; swap: boolean }[]>([]);
  const goneTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const self = useRef<HTMLElement>(null);
  const cabinet = useRef<HTMLDivElement>(null);
  const slip = useRef<HTMLDivElement>(null);
  // 닫으면 포커스를 돌려줄, 마지막으로 누른 앞판이에요.
  const front = useRef<HTMLButtonElement | null>(null);
  // 여는 동안 목록 종이를 숨겨 두는 움직임, 꺼내기 시작할 타이머, 꺼내 간 서랍 속 종이예요(growFrom).
  const grow = useRef<{ hold?: Animation; timer?: ReturnType<typeof setTimeout>; sheet?: Animation }>({});
  const stopGrow = () => {
    clearTimeout(grow.current.timer);
    grow.current.hold?.cancel();
    // 꺼내 간 서랍 속 종이를 제자리에 되돌려요.
    grow.current.sheet?.cancel();
    grow.current = {};
  };
  useEffect(() => stopGrow, []);
  const shown = items.length > 0;
  useImperativeHandle(ref, () => self.current as HTMLElement, [shown]);
  // 서랍을 열면 목록으로 포커스를 옮겨, 화살표로 바로 내리고 Tab으로 파일을 고를 수 있어요.
  useEffect(() => {
    if (open) slip.current?.querySelector<HTMLElement>(".kind-slip-paper:not([data-leaving]) .kind-folder")?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    const timers = goneTimers.current;
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, []);
  // 닫히기 시작한 서랍을, 다 들어가고 새 목록 종이가 옛 종이를 덮을 때까지(--dur-drawer, CSS는 --dur-3 + --dur-2에 끝나요) 붙들어 둬요. 움직임 줄이기면 붙들 움직임이 없어요.
  const letGo = (label: string, swap: boolean) => {
    if (reducedMotion()) return;
    const timers = goneTimers.current;
    clearTimeout(timers.get(label));
    setGone((list) => [...list.filter((item) => item.label !== label), { label, swap }]);
    const ms = tokenMs("--dur-drawer", self.current ?? undefined);
    timers.set(label, setTimeout(() => {
      timers.delete(label);
      setGone((list) => list.filter((item) => item.label !== label));
    }, ms));
  };
  // 서랍장 크기는 레이아웃 한 번으로 바꾸고, 옛 자리에서 새 자리까지는 transform 으로 이어요(FLIP). 폭을 매 프레임 바꾸면 그때마다 레이아웃을 다시 계산해서 끊겨요.
  const moveCabinet = (change: () => void) => {
    const element = cabinet.current;
    if (!element || reducedMotion()) return change();
    const from = element.getBoundingClientRect();
    element.getAnimations().forEach((running) => running.cancel());
    flushSync(change);
    const to = element.getBoundingClientRect();
    if (from.left === to.left && from.top === to.top && from.width === to.width) return;
    const tokens = getComputedStyle(element);
    element.animate(
      { transform: [`translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width})`, "none"] },
      { duration: tokenMs("--dur-drawer", element), easing: tokens.getPropertyValue("--ease-drawer") },
    );
  };
  const shownList = useRef<string | null>(null);
  useEffect(() => {
    if (shownList.current !== null && shownList.current !== open) onListGone?.();
    shownList.current = open;
  }, [open, onListGone]);
  // 닫으면 그 서랍 앞판으로 포커스를 돌려줘요.
  const close = () => {
    stopGrow();
    moveCabinet(() => {
      if (open) letGo(open, false);
      setOpen(null);
    });
    front.current?.focus({ preventScroll: true });
  };
  // Drawer 탭에서는 포커스가 어디 있든 Esc로 열린 서랍을 닫아요.
  // 홈 탭에서는 숨은 서랍장에 남은 포커스로 서랍이나 파일을 열거나 숨은 목록을 내리지 않아요.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!awayFromHome()) {
        if (target?.closest(".kind-shelves") && (event.key === "Enter" || event.key === " " || ((event.key === "PageDown" || event.key === "PageUp") && target.closest(".kind-folder")))) event.preventDefault();
        return;
      }
      // 대화상자·메뉴·미리보기 창이 떠 있거나 글을 쓰는 중이면 Esc는 그쪽 몫이에요. 그쪽이 먼저 닫혀 버리기 전에 보려고 캡처 단계에서 들어요.
      if (event.key !== "Escape" || !open || document.querySelector("dialog[open], .context-menu, .preview-pane") || target?.closest("input, textarea, select, [contenteditable]")) return;
      event.preventDefault();
      close();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);
  if (!shown) return null;
  const listed = shelves.find((shelf) => shelf.label === last) ?? null;
  // 다른 서랍이 닫히는 중에 연 서랍은 그 서랍이 들어가기 시작한 뒤에 따라 나와요(CSS data-handoff). 들어가던 서랍을 다시 열면 멈칫하지 않고 바로 돌아 나와요.
  const handoff = open !== null && gone.length > 0 && !gone.some((item) => item.label === open);
  // 바꿔 열면 옛 목록 종이가 새 종이 밑에 잠깐 남아요. 서랍 순서대로 놓아 React가 종이를 옮기지 않으니 옛 종이는 다시 그려지지 않고 그 자리에서 사라져요. 새 종이는 CSS z-index로 위에 와요.
  const leaving = new Set(gone.filter((item) => item.swap && item.label !== last).map((item) => item.label));
  const papers = shelves.filter((shelf) => shelf === listed || leaving.has(shelf.label));
  // 넓은 창에서 목록 종이는 서랍이 빠져나오고 속 종이가 튀어 오른 뒤, 그 종이들 자리에서 작은 종이로 떠올라 오른쪽 칸까지 커지며 펼쳐져요(growFrom).
  // 닫을 때는 처음 누른 서랍 자리로 작아지며 들어가요(아래 CSS 변수와 styles.css transition). 좁은 창은 지금처럼 아래에서 올라와요.
  const wide = () => matchMedia("(min-width: 721px)").matches;
  const riseFrom = (stage: HTMLElement, drawer: DOMRect, box: DOMRect) => {
    if (!wide()) {
      for (const name of ["--kind-slip-from", "--kind-slip-alpha", "--kind-slip-scale"]) stage.style.removeProperty(name);
      return;
    }
    const x = drawer.left + drawer.width / 2 - (box.left + box.width / 2);
    const y = drawer.top + drawer.height / 2 - (box.top + box.height / 2);
    stage.style.setProperty("--kind-slip-from", `${Math.round(x)}px ${Math.round(y)}px`);
    stage.style.setProperty("--kind-slip-alpha", "0");
    stage.style.setProperty("--kind-slip-scale", "0.35");
  };
  // 서랍이 빠져나오고 속 종이가 튀어 오르면, 맨 앞 종이 한 장을 위로 꺼내 들어(제 모양으로 펴지며) 오른쪽 목록 창 자리로 옮겨 펼쳐요.
  // 꺼낸 동안 서랍 속 그 종이는 비어 있고, 닫거나 다른 서랍을 열면 돌아와요(stopGrow).
  const growFrom = (pressed: HTMLElement) => {
    const paper = slip.current?.querySelector<HTMLElement>(".kind-slip-paper:not([data-leaving])");
    if (!paper || !wide() || reducedMotion()) return;
    // 서랍과 속 종이가 먼저 나오는 동안(--dur-3) 목록 종이는 숨어 있어요.
    const hold = paper.animate({ opacity: [0, 0] }, { duration: 60_000, fill: "forwards" });
    grow.current = {
      hold,
      timer: setTimeout(() => {
        const sheets = pressed.closest(".kind-drawer")?.querySelectorAll<HTMLElement>(".kind-drawer-sheet");
        const sheet = sheets?.[sheets.length - 1];
        // 서랍장이 아직 움직이는 중이라, 이 순간 종이가 보이는 자리에서 꺼내요.
        const from = sheet?.getBoundingClientRect();
        const to = paper.getBoundingClientRect();
        hold.cancel();
        if (!sheet || !from || from.width === 0 || to.width === 0) return;
        const tokens = getComputedStyle(paper);
        const center = (box: { left: number; top: number; width: number; height: number }) => [box.left + box.width / 2 - (to.left + to.width / 2), box.top + box.height / 2 - (to.top + to.height / 2)];
        // 1) 서랍 속 종이와 꼭 같은 자리·크기. 2) 같은 폭으로 제 비율까지 펴지며 서랍 위로 들려 나옴. 3) 목록 창 자리.
        const sx = from.width / to.width;
        const [x0, y0] = center(from);
        // 들린 종이는 서랍 위 남은 자리(화면 위 끝까지 --space-4 남김) 안에 들어가게 줄여요. 가운데는 서랍 속 종이에 맞춰요.
        const sl = Math.min(sx, (from.top - parseFloat(cssToken("--space-4", paper))) / to.height);
        const lifted = { left: from.left + (from.width - to.width * sl) / 2, width: to.width * sl, height: to.height * sl, top: from.top - to.height * sl };
        const [x1, y1] = center(lifted);
        const ms = tokenMs("--dur-drawer", paper) * 1.5;
        grow.current = { sheet: sheet.animate({ opacity: [0, 0] }, { duration: 60_000, fill: "forwards" }) };
        // 들린 종이는 윗부분이 뒤로 기운 채 서랍 위에 서 있다가, 화면 앞으로 다가오며 똑바로 서고 조금 넘치게 커졌다가 창 자리에 내려앉아요.
        // 원근 깊이는 창 높이에 맞춰요. 모든 단계의 변환 함수 목록을 같게 둬야 행렬로 뭉개지지 않고 각각 이어져요.
        const depth = `perspective(${Math.round(to.height * 2)}px)`;
        const at = (x: number, y: number, tilt: number, scale: string) => `translate(${x}px, ${y}px) ${depth} rotateX(${tilt}deg) scale(${scale})`;
        paper.animate(
          [
            { transform: at(x0, y0, 0, `${sx}, ${from.height / to.height}`), boxShadow: tokens.getPropertyValue("--shadow-1"), easing: tokens.getPropertyValue("--ease-settle") },
            { transform: at(x1, y1, 18, `${sl}`), offset: 0.3, easing: tokens.getPropertyValue("--ease-standard") },
            { transform: at(0, 0, 0, "1.04"), boxShadow: tokens.getPropertyValue("--shadow-3"), offset: 0.8, easing: tokens.getPropertyValue("--ease-settle") },
            { transform: at(0, 0, 0, "1"), boxShadow: tokens.getPropertyValue("--shadow-2") },
          ],
          { duration: ms },
        );
      }, tokenMs("--dur-3", paper)),
    };
  };
  const toggle = (shelf: Shelf, pressed: HTMLButtonElement) => {
    front.current = pressed;
    const next = open === shelf.label ? null : shelf.label;
    // 앞판을 다시 눌러 닫을 때도 Esc·닫기처럼 앞판에 포커스를 둬요. WebKit은 눌러도 버튼에 포커스를 주지 않아요.
    if (next === null) return close();
    stopGrow();
    const stage = pressed.closest<HTMLElement>(".kind-stage");
    const drawer = pressed.closest(".kind-drawer")?.getBoundingClientRect();
    const box = slip.current?.getBoundingClientRect();
    // 넓은 창에서 여는 움직임은 growFrom이 맡아요. CSS 첫 모습(@starting-style)은 제자리로 둬요.
    if (stage && wide()) {
      stage.style.setProperty("--kind-slip-from", "0px 0px");
      stage.style.setProperty("--kind-slip-alpha", "1");
      stage.style.setProperty("--kind-slip-scale", "1");
    }
    moveCabinet(() => {
      // 닫혀 있다가 열면 목록 칸과 함께 빠져나가던 옛 종이를 되살리지 않아요. 되살리면 반쯤 사라진 종이가 제자리로 튀어요.
      if (open) letGo(open, true);
      else setGone((list) => list.map((item) => ({ ...item, swap: false })));
      setOpen(next);
      if (next) setLast(next);
    });
    growFrom(pressed);
    // 닫을 때 돌아갈 자리(처음 누른 서랍)는 연 뒤에 적어요. 먼저 적으면 여는 첫 모습으로 쓰여요.
    if (stage && drawer && box) riseFrom(stage, drawer, box);
  };
  // 나누기를 바꾸면 열린 서랍과 붙들던 서랍을 모두 내려놓아요. 서랍 이름이 서로 달라 옛 서랍이 남아 있을 자리가 없어요.
  const switchMode = (next: string) => {
    stopGrow();
    goneTimers.current.forEach((timer) => clearTimeout(timer));
    goneTimers.current.clear();
    setGone([]);
    setOpen(null);
    setLast(null);
    setMode(next);
  };
  // 서랍장 구성을 바꾸면 열린 서랍을 내려놓고 저장해요. 저장에 실패해도 이번 화면에는 바뀐 대로 보여요.
  const saveViews = (next: ShelfViews, nextMode = mode) => {
    setViews(next);
    saveShelfViews(next).catch((error: unknown) => console.error(error));
    switchMode(nextMode);
    setEditing(null);
  };
  const viewNames = [...reservedViewNames, ...views.custom.map((view) => view.name)];
  const defaultDrawers: DrawerSpec[] = colorGroups.map((group) => ({ id: group.label, name: group.label, kinds: group.kinds }));
  const editable = mode === "kind" || Boolean(customView);
  return (
    <section ref={self} className="kind-shelves" aria-labelledby="kind-shelves-title">
      {/* 펜 떨림: 서랍장 선을 프로도처럼 손으로 그린 선으로 흔들어요. 글자에는 쓰지 않아요. */}
      <svg className="kind-pen-defs" aria-hidden="true" focusable="false">
        <filter id="kind-pen">
          <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="7" />
          <feDisplacementMap in="SourceGraphic" scale="4" />
        </filter>
      </svg>
      <header className="kind-shelves-head">
        {/* 제목은 머리줄 탭(Drawer)과 겹쳐 화면에서는 숨기고, 화면 읽기 프로그램에만 이 영역 이름으로 남겨요. */}
        <h2 id="kind-shelves-title" className="sr-only">Drawer</h2>
        <div className="kind-shelves-tools">
          <label className="kind-shelves-criterion">
            분류 기준
            <select value={mode} onChange={(event) => switchMode(event.target.value)}>
              <optgroup label="기본 분류">
                {builtInShelfViews.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
              </optgroup>
              {views.custom.length > 0 && <optgroup label="내 서랍장">
                {views.custom.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
              </optgroup>}
            </select>
          </label>
          <button type="button" className="quiet kind-shelves-add" aria-label="새 서랍장 만들기" title="새 서랍장 만들기" onClick={() => setEditing("new")}>+</button>
          <button type="button" className={`quiet${editable ? "" : " kind-shelves-keep"}`} title="서랍장 고치기" disabled={!editable} onClick={() => setEditing("edit")}>편집</button>
        </div>
        {note && <p className="kind-shelves-note" aria-live="polite">{note}</p>}
      </header>
      {shelves.length > 0 && (
        <div className="kind-stage" data-open={open !== null} data-handoff={handoff}>
          <div className="kind-cabinet-wrap">
            {/* 서랍장이 아래로 물러나는 판이에요. 바깥 판의 스크롤 등장 애니메이션과 따로 움직여야 transition이 막히지 않아요. */}
            <div className="kind-cabinet-sink">
              <div ref={cabinet} className="kind-cabinet" style={{ "--rows3": Math.ceil(shelves.length / 3), "--rows2": Math.ceil(shelves.length / 2) } as CSSProperties}>
                <span className="kind-cabinet-line" aria-hidden="true" />
                {shelves.map((shelf) => (
                  <Drawer key={shelf.label} shelf={shelf} on={open === shelf.label} closing={open !== shelf.label && gone.some((item) => item.label === shelf.label)} onToggle={(pressed) => toggle(shelf, pressed)} />
                ))}
              </div>
            </div>
          </div>
          <div ref={slip} id={slipId} className="kind-slip" role="region" aria-labelledby="kind-slip-title" data-open={open !== null} inert={open === null}>
            {papers.map((shelf) => (
              // key 로 종이를 바꿔 끼워서, 다른 서랍을 열 때마다 새 종이가 다시 내려앉아요.
              <SlipPaper key={shelf.label} shelf={shelf} leaving={shelf !== listed} folders={folders} onOpenFile={onOpenFile} onClose={close} onTrashed={onTrashed} />
            ))}
          </div>
        </div>
      )}
      {editing === "new" && (
        <ShelfEditor
          title="새 서랍장"
          name=""
          drawers={[{ id: "drawer-first", name: "새 서랍", kinds: [] }]}
          items={items}
          seconds={seconds}
          onClose={() => setEditing(null)}
          onSave={(name, next) => {
            const id = `view-${Date.now().toString(36)}`;
            saveViews({ ...views, custom: [...views.custom, { id, name: uniqueName(name, viewNames), drawers: next }] }, id);
          }}
        />
      )}
      {editing === "edit" && mode === "kind" && (
        <ShelfEditor title="형식별 서랍장" drawers={views.kind ?? defaultDrawers} items={items} seconds={seconds} onClose={() => setEditing(null)} onSave={(_, next) => saveViews({ ...views, kind: next })} onReset={() => saveViews({ ...views, kind: null })} />
      )}
      {editing === "edit" && customView && (
        <ShelfEditor
          title="서랍장"
          name={customView.name}
          drawers={customView.drawers}
          items={items}
          seconds={seconds}
          onClose={() => setEditing(null)}
          onSave={(name, next) => saveViews({ ...views, custom: views.custom.map((view) => (view.id === customView.id ? { ...view, name: uniqueName(name, viewNames.filter((taken) => taken !== view.name)), drawers: next } : view)) })}
          onDelete={() => saveViews({ ...views, custom: views.custom.filter((view) => view.id !== customView.id) }, "kind")}
        />
      )}
    </section>
  );
});

const pickKey = (item: ShelfItem) => `${item.room.id}:${item.thing.id}`;

// 목록 종이 한 장. 바꿔 열어 사라지는 중인 옛 종이(leaving)는 손이 닿지 않고 읽히지 않으며, 제목 id도 새 종이에 넘겨요.
// 데스크톱에서는 '고르기'로 여러 파일을 골라 한 번에 휴지통으로 보내요. 묻고 나서 보내고, 휴지통에서 되살릴 수 있어요.
export function SlipPaper({ shelf, leaving, folders, onOpenFile, onClose, onTrashed }: { shelf: Shelf; leaving: boolean; folders: Map<string, Folder>; onOpenFile: (roomId: string, thingId: string) => void; onClose: () => void; onTrashed?: (message: string, undo?: ToastAction) => void }) {
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  // 폴더 경로를 아는(데스크톱에서 연결한) 방의 파일만 고를 수 있어요.
  const canPick = (item: ShelfItem) => typeof folders.get(item.room.id) === "string";
  const pickable = isNative() && onTrashed !== undefined && shelf.items.some(canPick);
  const trashPicked = async () => {
    const chosen = shelf.items.filter((item) => picked?.has(pickKey(item)));
    if (chosen.length === 0 || !(await window.confirm(`파일 ${countText(chosen.length)}개를 휴지통으로 보낼까요? 휴지통에서 되살릴 수 있어요.`))) return;
    setBusy(true);
    const done = new Map<string, Set<string>>();
    // 되돌릴 수 있게 휴지통 안 자리를 받아 둬요(macOS만 알려 줘요).
    const placed: { roomId: string; folder: string; thing: ShelfItem["thing"]; place: string }[] = [];
    let failed = 0;
    // 하나씩 차례로 보내요. 하나가 실패해도 나머지는 계속해요.
    for (const { room, thing } of chosen) {
      const folder = folders.get(room.id);
      try {
        if (typeof folder !== "string") throw new Error("폴더 없음");
        const place = await trashFile(folder, thing.path);
        if (place) placed.push({ roomId: room.id, folder, thing, place });
        done.set(room.id, (done.get(room.id) ?? new Set()).add(thing.id));
      } catch (error) {
        // 이미 없는 파일은 기록에서만 빼요.
        if (isNotFound(error)) done.set(room.id, (done.get(room.id) ?? new Set()).add(thing.id));
        else {
          console.error(error);
          failed++;
        }
      }
    }
    await Promise.all([...done].map(([roomId, ids]) => patchRoom(roomId, (current) => ({ ...current, things: current.things.filter((thing) => !ids.has(thing.id)) })).catch((error: unknown) => console.error(error))));
    setBusy(false);
    setPicked(null);
    const sent = chosen.length - failed;
    const undo: ToastAction | undefined = placed.length === 0 ? undefined : {
      label: "되돌리기",
      run: () =>
        void (async () => {
          const back = new Map<string, ShelfItem["thing"][]>();
          for (const { roomId, folder, thing, place } of placed) {
            try {
              await restoreTrashed(folder, thing.path, place);
              back.set(roomId, [...(back.get(roomId) ?? []), thing]);
            } catch (error) {
              console.error(error);
            }
          }
          await Promise.all([...back].map(([roomId, things]) => patchRoom(roomId, (current) => ({ ...current, things: [...current.things, ...things.filter((thing) => !current.things.some((item) => item.id === thing.id))] })).catch((error: unknown) => console.error(error))));
          const restored = [...back.values()].reduce((sum, things) => sum + things.length, 0);
          const missed = placed.length - restored;
          onTrashed?.(restored > 0 ? `파일 ${countText(restored)}개를 되돌렸어요.${missed > 0 ? ` ${countText(missed)}개는 되돌리지 못했어요. 휴지통에서 직접 꺼내 주세요.` : ""}` : "되돌리지 못했어요. 휴지통에서 직접 꺼내 주세요.");
        })(),
    };
    onTrashed?.(`${sent > 0 ? `파일 ${countText(sent)}개를 휴지통으로 보냈어요.` : ""}${failed > 0 ? ` ${countText(failed)}개는 보내지 못했어요.` : ""}`.trim(), undo);
  };
  return (
    <div className="kind-slip-paper" data-leaving={leaving || undefined} inert={leaving} aria-hidden={leaving || undefined} style={{ "--kind": colorOf(shelf) } as CSSProperties}>
      <div className="kind-folder-head">
        <h3 id={leaving ? undefined : "kind-slip-title"}>
          <span className="kind-dot" aria-hidden="true" />
          {shelf.label}
        </h3>
        <Meta className="kind-folder-count" items={[`${countText(shelf.items.length)}개`, formatBytes(shelf.size)]} />
        {pickable && <button type="button" className="quiet kind-pick-toggle" aria-pressed={picked !== null} onClick={() => setPicked(picked ? null : new Set())}>{picked ? "고르기 끝" : "고르기"}</button>}
        <button type="button" className="quiet icon-close kind-slip-close" aria-label="닫기" onClick={onClose}><Icon name="close" /></button>
      </div>
      <KindFolder shelf={shelf} folders={folders} onOpenFile={onOpenFile} picked={picked} canPick={canPick} onPick={(item) => setPicked((current) => {
        const next = new Set(current);
        if (!next.delete(pickKey(item))) next.add(pickKey(item));
        return next;
      })} />
      {picked && (
        <div className="kind-pick-bar" role="status">
          <span>{picked.size > 0 ? `${countText(picked.size)}개 골랐어요` : "보낼 파일을 눌러 골라 주세요"}</span>
          <button type="button" disabled={picked.size === 0 || busy} onClick={() => void trashPicked()}><Icon name="trash" />{busy ? "보내는 중…" : "휴지통"}</button>
        </div>
      )}
    </div>
  );
}

// 서랍 한 칸: 구멍(.kind-drawer) 안에서 앞판(누르는 곳)과 그 뒤의 속이 한 몸으로 빠져나와요.
function Drawer({ shelf, on, closing, onToggle }: { shelf: Shelf; on: boolean; closing: boolean; onToggle: (pressed: HTMLButtonElement) => void }) {
  const count = countText(shelf.items.length);
  return (
    <div className="kind-drawer" data-open={on} data-closing={closing || undefined} style={{ "--kind": colorOf(shelf) } as CSSProperties}>
      <div className="kind-drawer-body">
        {/* 속: 위에서 내려다본 벽과 바닥, 앞뒤로 줄지어 꽂힌 종이(형식 색 색인 탭). 닫혀 있으면 앞판 뒤에 숨어요. */}
        <span className="kind-drawer-tray" aria-hidden="true">
          <span className="kind-drawer-well" />
          {shelf.items.slice(0, peekCount).map((item, order, peeks) => (
            <span key={item.thing.id} className="kind-drawer-sheet" style={{ "--i": order, "--back": peeks.length - 1 - order } as CSSProperties} />
          ))}
        </span>
        <button
          type="button"
          className="kind-drawer-front"
          aria-expanded={on}
          aria-controls={slipId}
          aria-label={`${shelf.label} 서랍, ${count}개, ${formatBytes(shelf.size)}`}
          onClick={(event) => onToggle(event.currentTarget)}
        >
          <span className="kind-drawer-plate">
            <span className="kind-dot" aria-hidden="true" />
            <b>{shelf.label}</b>
          </span>
          <span className="kind-drawer-count">
            {count}개 · {formatBytes(shelf.size)}
          </span>
          <span className="kind-drawer-handle" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

// 목록 종이 몸: 파일 카드가 위아래로 겹쳐 쌓여 있고, 파일이 많으면 여기서 내려요.
// picked가 있으면 고르는 중이라 카드를 누르면 열지 않고 골라요.
export function KindFolder({ shelf, folders, onOpenFile, picked = null, canPick, onPick }: { shelf: Shelf; folders: Map<string, Folder>; onOpenFile: (roomId: string, thingId: string) => void; picked?: Set<string> | null; canPick?: (item: ShelfItem) => boolean; onPick?: (item: ShelfItem) => void }) {
  const [count, setCount] = useState(shownStep);
  const shown = shelf.items.slice(0, count);
  const more = shelf.items.length > shown.length;
  const end = useRef<HTMLDivElement>(null);
  // 목록 끝 표시가 스크롤 상자(.kind-folder) 아래 한 화면 안에 들어오면 다음 묶음을 놓아요.
  useEffect(() => {
    const el = end.current;
    if (!more || !el) return;
    const observer = new IntersectionObserver((seen) => seen.some((entry) => entry.isIntersecting) && setCount((now) => now + shownStep), { root: el.parentElement, rootMargin: "0px 0px 100% 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [more, count]);
  return (
    <div className="kind-folder" role="group" aria-labelledby="kind-slip-title" tabIndex={-1}>
      <ul className="kind-folder-things">
        {shown.map((item, order) => (
          <li key={item.thing.id}>
            <ShelfPaper item={item} order={order} folder={folders.get(item.room.id) ?? null} picked={picked ? picked.has(pickKey(item)) : undefined} pickDisabled={picked !== null && canPick?.(item) === false} onOpen={() => (picked ? onPick?.(item) : onOpenFile(item.room.id, item.thing.id))} />
          </li>
        ))}
      </ul>
      {more && <div ref={end} className="kind-folder-end" aria-hidden="true" />}
    </div>
  );
}

// picked가 undefined면 고르는 중이 아니에요. 고르는 중엔 눌림(aria-pressed)과 체크 표시로 고른 것을 보여요.
function ShelfPaper({ item, order, folder, picked, pickDisabled = false, onOpen }: { item: ShelfItem; order: number; folder: Folder | null; picked?: boolean; pickDisabled?: boolean; onOpen: () => void }) {
  const { room, thing, versions } = item;
  const seconds = item.durationSeconds === undefined ? undefined : Math.floor(item.durationSeconds);
  const duration = seconds === undefined ? "" : `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
  const details = [room.name, formatBytes(thing.size), duration].filter(Boolean);
  const self = useRef<HTMLButtonElement>(null);
  const own = usePicture(thing.id);
  const thumb = useThumb(self, own ? null : folder, thing);
  return (
    <button
      ref={self}
      type="button"
      className="shelf-paper"
      style={{ "--i": order } as CSSProperties}
      title={`${thing.name} (${room.name} 방)`}
      aria-label={`${thing.name}, ${room.name} 방, ${formatBytes(thing.size)}${duration ? `, ${duration}` : ""}${versions > 1 ? `, 버전 ${versions}개 중 최신` : ""}`}
      aria-pressed={picked}
      disabled={pickDisabled}
      onClick={onOpen}
    >
      {/* 카드 테두리: 서랍장과 같은 펜 선. 글자가 흔들리지 않게 선만 따로 그려요. */}
      <span className="shelf-paper-line" aria-hidden="true" />
      <span className="shelf-art">
        <ObjectShape kind={thing.kind} size={cardArtPx} seed={thing.id} picture={own ?? thumb} />
      </span>
      {/* 카드 윗줄(이름·방)은 다음 카드에 가려지지 않는 자리에 있어요. */}
      <span className="shelf-meta">
        <span className="shelf-name-row">
          <span className="shelf-name">{thing.name}</span>
          {versions > 1 && <b>버전 {versions}</b>}
        </span>
        <span className="shelf-room">{details.join(" · ")}</span>
      </span>
    </button>
  );
}
