import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { ObjectShape } from "../../art/ObjectShape";
import { colorGroups } from "../../art/palette";
import { formatBytes, type Room } from "../../domain/model";
import { hueColors, type Hue } from "../../domain/hue";
import { hueShelves, kindShelves, shelfItems, type Shelf, type ShelfItem } from "../../domain/shelves";
import { AxisWindow, axisMs, SceneWheelGate } from "../../domain/wheelStep";
import type { Folder } from "../../gateways/native";
import { usePicture } from "../../storage/pictures";
import { canThumb, useHuesOf, useReadableFolders, useThumb } from "../../storage/thumbs";
import { Meta } from "../Meta";
import { awayFromHome } from "./engine";
import { cssToken, tokenMs } from "../tokens";

// 목록 종이에 처음엔 이만큼, 더 보기를 누르면 shownMost장까지 놓아요(파일 수백 개짜리 방).
const shownAtFirst = 12;
const shownMost = 120;
// 열린 서랍 안에 앞뒤로 겹쳐 꽂힌 종이 수.
const peekCount = 5;
const cardArtPx = 40;
// 장면을 JS로 옮기는 동안 스냅을 꺼 두는 시간. WebKit은 200ms, WebView2는 키 큰 창에서 650ms쯤 걸려요.
const snapOffMs = 700;
const slipId = "kind-slip";

// 형식 서랍은 형식 색, 컬러별 서랍은 그 색 네모(HueSwatches와 같은 --hue-*)예요.
const colorOf = (shelf: Shelf) => colorGroups.find((group) => group.label === shelf.label)?.color ?? hueColors[shelf.label as Hue];
const countText = (count: number) => count.toLocaleString("ko-KR");
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// 홈 아래 한 장면: 홈에 둔 방들의 파일을 형식마다 서랍 하나에 나눠 담은 서랍장이에요.
// 서랍을 누르면 앞으로 빠져나오며 안의 종이가 튀어 오르고, 나머지 서랍은 흐려지고, 옆에 그 서랍의 목록 종이가 펼쳐져요. 한 번에 한 서랍만 열려요.
// 주름관은 방 하나만 뜻해서 여기에는 쓰지 않아요. 색은 형식 색만 써요.
export const KindShelf = forwardRef<HTMLElement, { rooms: Room[]; onOpenFile: (roomId: string, thingId: string) => void }>(function KindShelf({ rooms, onOpenFile }, ref) {
  // 형식별(kind) 또는 컬러별(hue). 컬러별은 이미지 색을 읽어야 해서 고른 뒤에만 읽기 시작해요.
  const [mode, setMode] = useState<"kind" | "hue">("kind");
  const kinds = useMemo(() => kindShelves(rooms, colorGroups), [rooms]);
  const items = useMemo(() => shelfItems(rooms), [rooms]);
  const folders = useReadableFolders(rooms.filter((room) => !room.care.done));
  const readable = useMemo(() => items.flatMap(({ room, thing }) => (folders.has(room.id) ? [{ folder: folders.get(room.id)!, thing }] : [])), [items, folders]);
  const { hues, total: imageCount } = useHuesOf(readable, mode === "hue");
  // 이미지는 있는데 읽을 폴더가 없으면(샘플·폴더 연결 전 방) 빈 화면 대신 이유를 적어요.
  const unreadImages = useMemo(() => items.some(({ thing }) => canThumb(thing)), [items]);
  const shelves = useMemo(() => (mode === "kind" ? kinds : hueShelves(items, hues)), [mode, kinds, items, hues]);
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
  const shown = kinds.length > 0;
  useImperativeHandle(ref, () => self.current as HTMLElement, [shown]);
  // 집 화면과 이 장면은 휠 한 칸·한 번 쓸기에 한 장면씩 넘어가요. CSS scroll-snap 만으로는 휠 한 칸이 제자리로 튕겨 돌아와서 여기서 넘겨요.
  // 목록 종이 안에 더 내릴 파일이 있으면 그 종이가 먼저 내려가요.
  useEffect(() => {
    const section = self.current;
    const scroller = section?.closest<HTMLElement>(".home");
    if (!section || !scroller) return;
    const gate = new SceneWheelGate();
    const axis = new AxisWindow();
    let snapBack: ReturnType<typeof setTimeout> | undefined;
    let later: ReturnType<typeof setTimeout> | undefined;
    // JS로 옮기는 중인 장면 맨 위. 닿으면 바로 스냅을 되돌려요.
    let moving: number | null = null;
    const snapOn = () => {
      clearTimeout(snapBack);
      moving = null;
      scroller.style.scrollSnapType = "";
    };
    const onScroll = () => {
      if (moving !== null && Math.abs(scroller.scrollTop - moving) < 1) snapOn();
    };
    const go = (to: number, cancelable: boolean) => {
      // 손가락을 떼는 신호는 JS가 막을 수 없고, WebKit은 그때 스냅으로 이동을 가로채 튕겨 돌아가거나 끊겨요. 옮기는 동안만 꺼요.
      // 닿으면 바로 켜서 그 뒤의 화살표·PageUp은 평소처럼 장면에 붙어요. scrollend는 WebKit에서 도중에 여러 번 오니 쓰지 않아요.
      // 막을 수 없는 휠(Chromium에서 손짓 첫 값을 놓친 경우)은 페이지도 함께 움직이니 스냅을 그대로 둬요.
      if (cancelable) {
        scroller.style.scrollSnapType = "none";
        moving = to;
        clearTimeout(snapBack);
        snapBack = setTimeout(() => {
          // 닿기 전에 키 스크롤 등으로 끊겼으면 가까운 장면에 붙여요. 스냅을 다시 켜도 WebKit은 장면 사이에 멈춘 채로 둬요.
          const top = scroller.scrollTop;
          snapOn();
          if (top > 1 && Math.abs(top - section.offsetTop) > 1) scroller.scrollTo({ top: top < section.offsetTop / 2 ? 0 : section.offsetTop, behavior: reducedMotion() ? "auto" : "smooth" });
        }, snapOffMs);
      }
      scroller.scrollTo({ top: to, behavior: reducedMotion() ? "auto" : "smooth" });
    };
    const onWheel = (event: WheelEvent) => {
      const target = event.target as Element;
      axis.add(event.deltaX, event.deltaY, event.timeStamp);
      if (event.ctrlKey || event.shiftKey || event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY) || target.closest("dialog, .context-menu")) return;
      const list = target.closest<HTMLElement>(".kind-folder");
      const dy = event.deltaY * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? innerHeight : 1);
      const step = gate.push(dy, event.timeStamp, list !== null && (dy > 0 ? list.scrollTop + list.clientHeight < list.scrollHeight - 1 : list.scrollTop > 0));
      // WebKit은 목록이 시작한 손짓의 나머지를 취소할 수 없게 보내요. 그 손짓은 끝까지 목록 몫이에요.
      if (step === "list" || (!event.cancelable && list)) return;
      event.preventDefault();
      if (step === 0) return;
      const top = scroller.scrollTop;
      const to = step > 0 ? (top < section.offsetTop - 1 ? section.offsetTop : null) : top > 1 ? 0 : null;
      if (to === null) return;
      if (event.deltaX === 0) return go(to, event.cancelable);
      // 가로 값이 섞인 첫 값은 방을 고르는 가로 쓸기의 시작일 수 있어요. 잠깐 모아 보고 세로가 클 때만 넘겨요.
      axis.open(event.deltaX, event.deltaY, event.timeStamp);
      clearTimeout(later);
      const cancelable = event.cancelable;
      later = setTimeout(() => {
        if (!axis.sideways()) go(to, cancelable);
      }, axisMs);
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("wheel", onWheel);
      scroller.removeEventListener("scroll", onScroll);
      clearTimeout(later);
      snapOn();
    };
  }, [shown]);
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
  // 닫으면 그 서랍 앞판으로 포커스를 돌려줘요.
  const close = () => {
    stopGrow();
    moveCabinet(() => {
      if (open) letGo(open, false);
      setOpen(null);
    });
    front.current?.focus({ preventScroll: true });
  };
  // 서랍장 장면에서는 포커스가 어디 있든(제목을 눌렀거나 위 장면의 주름관에 남았어도) Esc로 열린 서랍을 닫아요.
  // 방 지도 장면에서는 화면 밖 서랍장에 남은 포커스로 서랍이나 파일을 열거나 숨은 목록을 내리지 않아요.
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
  const switchMode = (next: "kind" | "hue") => {
    goneTimers.current.forEach((timer) => clearTimeout(timer));
    goneTimers.current.clear();
    setGone([]);
    setOpen(null);
    setLast(null);
    setMode(next);
  };
  return (
    <section ref={self} className="kind-shelves" aria-labelledby="kind-shelves-title">
      <header className="kind-shelves-head">
        <h2 id="kind-shelves-title">{mode === "kind" ? "형식별로 보기" : "컬러별로 보기"}</h2>
        <div className="seg" role="radiogroup" aria-label="서랍 나누기">
          {(["kind", "hue"] as const).map((value) => (
            <label key={value}>
              <input type="radio" name="kind-shelves-mode" checked={mode === value} onChange={() => switchMode(value)} />
              {value === "kind" ? "형식별" : "컬러별"}
            </label>
          ))}
        </div>
        {mode === "hue" && hues.size < imageCount && <p className="kind-shelves-note" aria-live="polite">색을 읽는 중 {countText(hues.size)}/{countText(imageCount)}</p>}
        {mode === "hue" && imageCount === 0 && <p className="kind-shelves-note">{unreadImages ? "이미지가 있는 방의 폴더를 연결하면 색으로 볼 수 있어요. 샘플 방은 실제 파일이 없어 색을 읽지 못해요." : "색을 읽을 수 있는 이미지가 없어요."}</p>}
      </header>
      {shelves.length > 0 && (
        <div className="kind-stage" data-open={open !== null} data-handoff={handoff}>
          <div className="kind-cabinet-wrap">
            {/* 서랍장이 아래로 물러나는 판이에요. 바깥 판의 스크롤 등장 애니메이션과 따로 움직여야 transition이 막히지 않아요. */}
            <div className="kind-cabinet-sink">
              <div ref={cabinet} className="kind-cabinet" style={{ "--rows3": Math.ceil(shelves.length / 3), "--rows2": Math.ceil(shelves.length / 2) } as CSSProperties}>
                {shelves.map((shelf) => (
                  <Drawer key={shelf.label} shelf={shelf} on={open === shelf.label} closing={open !== shelf.label && gone.some((item) => item.label === shelf.label)} onToggle={(pressed) => toggle(shelf, pressed)} />
                ))}
              </div>
            </div>
          </div>
          <div ref={slip} id={slipId} className="kind-slip" role="region" aria-labelledby="kind-slip-title" data-open={open !== null} inert={open === null}>
            {papers.map((shelf) => (
              // key 로 종이를 바꿔 끼워서, 다른 서랍을 열 때마다 새 종이가 다시 내려앉아요.
              <SlipPaper key={shelf.label} shelf={shelf} leaving={shelf !== listed} folders={folders} onOpenFile={onOpenFile} onClose={close} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
});

// 목록 종이 한 장. 바꿔 열어 사라지는 중인 옛 종이(leaving)는 손이 닿지 않고 읽히지 않으며, 제목 id도 새 종이에 넘겨요.
export function SlipPaper({ shelf, leaving, folders, onOpenFile, onClose }: { shelf: Shelf; leaving: boolean; folders: Map<string, Folder>; onOpenFile: (roomId: string, thingId: string) => void; onClose: () => void }) {
  return (
    <div className="kind-slip-paper" data-leaving={leaving || undefined} inert={leaving} aria-hidden={leaving || undefined} style={{ "--kind": colorOf(shelf) } as CSSProperties}>
      <div className="kind-folder-head">
        <h3 id={leaving ? undefined : "kind-slip-title"}>
          <span className="kind-dot" aria-hidden="true" />
          {shelf.label}
        </h3>
        <Meta className="kind-folder-count" items={[`${countText(shelf.items.length)}개`, formatBytes(shelf.size)]} />
        <button type="button" className="quiet kind-slip-close" onClick={onClose}>닫기</button>
      </div>
      <KindFolder shelf={shelf} folders={folders} onOpenFile={onOpenFile} />
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
export function KindFolder({ shelf, folders, onOpenFile }: { shelf: Shelf; folders: Map<string, Folder>; onOpenFile: (roomId: string, thingId: string) => void }) {
  const [all, setAll] = useState(false);
  const shown = shelf.items.slice(0, all ? shownMost : shownAtFirst);
  return (
    <div className="kind-folder" role="group" aria-labelledby="kind-slip-title" tabIndex={-1}>
      <ul className="kind-folder-things">
        {shown.map((item, order) => (
          <li key={item.thing.id}>
            <ShelfPaper item={item} order={order} folder={folders.get(item.room.id) ?? null} onOpen={() => onOpenFile(item.room.id, item.thing.id)} />
          </li>
        ))}
      </ul>
      {shelf.items.length > shown.length &&
        (all ? (
          <p className="kind-folder-more">최근 {shownMost}개까지만 보여요. 나머지는 방 안에서 찾아 주세요.</p>
        ) : (
          <button type="button" className="kind-folder-more" onClick={() => setAll(true)}>나머지 {countText(shelf.items.length - shown.length)}개도 보기</button>
        ))}
    </div>
  );
}

function ShelfPaper({ item, order, folder, onOpen }: { item: ShelfItem; order: number; folder: Folder | null; onOpen: () => void }) {
  const { room, thing, versions } = item;
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
      aria-label={`${thing.name}, ${room.name} 방, ${formatBytes(thing.size)}${versions > 1 ? `, 버전 ${versions}개 중 최신` : ""}`}
      onClick={onOpen}
    >
      <span className="shelf-art">
        <ObjectShape kind={thing.kind} size={cardArtPx} seed={thing.id} picture={own ?? thumb} />
      </span>
      {/* 카드 윗줄(이름·방)은 다음 카드에 가려지지 않는 자리에 있어요. */}
      <span className="shelf-meta">
        <span className="shelf-name-row">
          <span className="shelf-name">{thing.name}</span>
          {versions > 1 && <b>버전 {versions}</b>}
        </span>
        <span className="shelf-room">{room.name} · {formatBytes(thing.size)}</span>
      </span>
    </button>
  );
}
