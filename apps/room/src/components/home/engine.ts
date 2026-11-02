/// <reference types="vite/client" />
import { createContext, useContext, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { Room } from "../../domain/model";
import type { RoomStat } from "../../domain/sky";
import type { OpenRoomMenu } from "../ContextMenu";

// 집 화면은 문서 스크롤이 없습니다. 숫자 하나(pos)가 모든 장면을 움직여요.
// 문턱을 넘은 휠과 손가락은 pos에 그대로 더하고, 입력이 140ms 멈추면 마지막 방향의 다음 자리까지 cubic-out으로 흘러갑니다.
export const stops: readonly number[] = [0, 1350, 3350, 4900, 5600, 6500];
// stops[i]에서 stops[i+1]까지의 시간(ms). 거리와 상관없이 구간마다 정해져 있습니다.
export const segmentMs: readonly number[] = [1400, 2005, 2400, 1805, 1500];
export const idleMs = 140;
// 메뉴나 Home/End처럼 여러 구간을 건너뛸 때의 시간.
const jumpMs = 1800;
const lastStop = stops.length - 1;
const touchSlop = 12;

// 장면 표. show 밖에서는 숨기고(그리지 않음), live 안에서만 조작할 수 있습니다. live는 빈틈없이 이어져 늘 한 장면만 살아 있어요.
export const scenes = [
  { name: "hero", label: "첫 화면", show: [0, 880], live: [0, 390] },
  { name: "notebook", label: "손댈 것", show: [380, 1800], live: [390, 1455] },
  { name: "table", label: "방", show: [1450, 4130], live: [1455, 4130] },
  { name: "dial", label: "방 모음", show: [4130, 5430], live: [4130, 5425] },
  // 판이 가장 빠른 한가운데를 피해, 막 들릴 때 조작을 넘깁니다.
  { name: "pile", label: "형식별", show: [5425, 6500], live: [5425, 5620] },
  { name: "footer", label: "맨 아래", show: [5600, 6500], live: [5620, 6500] },
] as const;

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
export const range = (pos: number, a: number, b: number) => clamp01((pos - a) / (b - a));
export const lin = (u: number) => u;
export const cubicOut = (u: number) => 1 - (1 - u) ** 3;
export const smooth = (u: number) => u * u * (3 - 2 * u);

export const clampPos = (pos: number) => Math.min(stops[lastStop], Math.max(0, pos));

// 방향으로 pos를 넘어선 첫 자리. 가까운 자리로 되돌아가는 일은 없습니다.
export function nextStop(pos: number, dir: number): number | null {
  if (dir > 0) {
    const index = stops.findIndex((stop) => stop > pos);
    return index < 0 ? null : index;
  }
  if (dir < 0) {
    for (let index = lastStop; index >= 0; index -= 1) if (stops[index] < pos) return index;
  }
  return null;
}

export function nearestStop(pos: number): number {
  return stops.reduce((best, stop, index) => (Math.abs(stop - pos) < Math.abs(stops[best] - pos) ? index : best), 0);
}

// 맞닿은 구간이면 그 구간의 시간, 여러 구간을 건너뛰면 jumpMs.
export function legMs(pos: number, target: number): number {
  if (pos < stops[target]) return target > 0 && pos >= stops[target - 1] ? segmentMs[target - 1] : jumpMs;
  return target < lastStop && pos <= stops[target + 1] ? segmentMs[target] : jumpMs;
}

export function tweenTarget(pos: number, dir: number): { stop: number; to: number; ms: number } | null {
  const stop = nextStop(pos, dir);
  return stop === null ? null : { stop, to: stops[stop], ms: legMs(pos, stop) };
}

export function tweenPos(from: number, to: number, elapsed: number, ms: number): number {
  return elapsed >= ms ? to : from + (to - from) * cubicOut(Math.max(0, elapsed) / ms);
}

// 휠 흐름 하나를 지켜봅니다. 트랙패드는 손을 뗀 뒤에도 관성 꼬리가 1~2초 흘러 그대로 더하면 장면을 건너뛰어요.
// 한 번 튕기면 한 장면만: 흐름은 다음 자리(wall)에서 멈추고 남은 꼬리는 버립니다. 쌓아 두지도 않아요.
// 속도가 줄지 않고 오래 이어지는 입력(휠을 계속 굴리기)은 일부러 미는 것이라 자리를 그냥 지나갑니다.
export type WheelStream = {
  at: number; // 마지막 입력 시각
  start: number; // 이 흐름이 시작한 시각
  dir: number;
  rate: number; // 부드럽게 고른 속도(px/ms)
  peak: number; // 천천히 잊는 최고 속도
  low: number; // 줄어드는 동안의 최저 속도
  wall: number;
};
const rateMs = 150; // 속도를 고르는 시간
const peakMs = 2000; // 최고 속도를 잊는 시간
const fadeRatio = 0.6; // 최고 속도의 이만큼 아래면 관성으로 봅니다.
const sustainMs = 1000; // 줄지 않고 이만큼 이어지면 일부러 미는 입력입니다.
const tailMs = 500; // 꼬리는 드문드문 와도 이 안이면 같은 흐름이에요.
const arrivedPx = 60; // cubic-out의 끝자락은 이미 멈춘 것처럼 보입니다. 이 안에서 새로 밀면 그다음 자리로 갑니다.

const wallFrom = (pos: number, dir: number) => {
  const ahead = clampPos(pos + arrivedPx * dir);
  const stop = nextStop(ahead, dir);
  return stop === null ? ahead : stops[stop];
};

export function gateWheel(prev: WheelStream | null, pos: number, delta: number, now: number): { stream: WheelStream; delta: number } {
  const size = Math.abs(delta);
  const dir = Math.sign(delta);
  const fresh = (rate: number): WheelStream => ({ at: now, start: now, dir, rate, peak: rate, low: Infinity, wall: wallFrom(pos, dir) });
  let stream: WheelStream;
  const gap = prev ? now - prev.at : Infinity;
  const speed = size / Math.max(gap, 8);
  const fading = prev !== null && prev.rate < prev.peak * fadeRatio;
  if (!prev || prev.dir !== dir || (gap >= idleMs && !(fading && gap < tailMs && speed <= prev.rate * 1.5))) {
    stream = fresh(0);
  } else {
    // 첫 입력은 간격을 몰라 속도가 없습니다. 둘째 입력부터 잽니다.
    const rate = prev.rate === 0 ? speed : prev.rate + (speed - prev.rate) * (1 - Math.exp(-gap / rateMs));
    const peak = Math.max(rate, prev.peak * Math.exp(-gap / peakMs));
    const faded = rate < peak * fadeRatio;
    const low = faded ? Math.min(prev.low, rate) : Infinity;
    // 줄어들던 속도가 다시 뛰면 꼬리 위에 새로 튕긴 손가락입니다. 다음 자리까지 한 번 더 갑니다.
    if (faded && rate > low * 2 + 0.3) stream = fresh(rate);
    else stream = { ...prev, at: now, rate, peak, low, wall: !faded && now - prev.start >= sustainMs ? wallFrom(pos, dir) : prev.wall };
  }
  return { stream, delta: Math.max(0, Math.min(size, (stream.wall - pos) * dir)) * dir };
}

// 마우스를 살짝 건드린 값까지 받으면 멈추면서 다음 자리로 흘러가 화면이 저절로 넘어갑니다. 한 방향으로 이만큼 모여야 미는 것으로 봅니다.
// 한 번 넘으면 그 흐름이 이어지는 동안은 그대로 통과합니다. 잠깐 멈추거나 방향이 바뀌면 다시 모아요.
export type WheelArm = { at: number; dir: number; sum: number };
export const wheelSlopPx = 60;
const armMs = 300;

export function armWheel(prev: WheelArm | null, delta: number, now: number): WheelArm {
  const dir = Math.sign(delta);
  const going = prev !== null && prev.dir === dir && now - prev.at < armMs;
  return { at: now, dir, sum: (going ? prev.sum : 0) + Math.abs(delta) };
}

export function liveScene(pos: number): number {
  const index = scenes.findIndex((scene) => pos < scene.live[1]);
  return index < 0 ? scenes.length - 1 : index;
}

// 마지막 구간은 판 전체가 들려 아래 맨 끝 장면을 드러냅니다. dvh 단위로 돌려줍니다.
export const sheetLift = (pos: number) => -116 * smooth(range(pos, stops[lastStop - 1], stops[lastStop]));

const ownInput = ".sky-panel, dialog, [data-own-wheel], .context-menu";
const typing = "input, textarea, select, [contenteditable]";
const control = `${typing}, button, a, summary, [role="button"]`;
const inside = (target: EventTarget | null, selector: string) => target instanceof Element && target.closest(selector) !== null;
// 스크롤할 게 없는 목록 위에서는 휠이 장면을 넘깁니다. 안 그러면 판 위에서 멈춘 듯 보여요.
const ownsScroll = (target: EventTarget | null) => {
  const own = target instanceof Element ? target.closest<HTMLElement>(ownInput) : null;
  return own !== null && (!own.matches("[data-own-wheel]") || own.scrollHeight > own.clientHeight);
};
export const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export type Engine = {
  readonly pos: number;
  readonly dir: number;
  // 지금 향하는 자리. 멈춰 있으면 지금 자리예요.
  readonly target: number;
  // 흐르고 있거나 곧 흐를 참입니다.
  readonly moving: boolean;
  subscribe: (listener: () => void) => () => void;
  input: (delta: number) => void;
  wheel: (delta: number, at?: number) => void;
  // 손가락이 닿아 있는 동안은 자동으로 흘러가지 않습니다.
  hold: (down: boolean) => void;
  step: (dir: number) => void;
  goTo: (stop: number) => void;
  // 가던 자리에 바로 닿습니다.
  arrive: () => void;
  // 방이 하나도 없으면 옮겨 갈 장면이 없습니다. 첫 화면에 그대로 둡니다.
  lock: (on: boolean) => void;
  attach: () => () => void;
};

export function createEngine(startStop = 0): Engine {
  let pos = stops[startStop];
  let dir = 0;
  let shown = pos;
  let tween: { from: number; to: number; start: number; ms: number } | null = null;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let frameId = 0;
  // 동작 줄이기: 입력이 멈출 때까지 한 번만 넘어갑니다.
  let settling = false;
  // 입력이 멈추기를 기다리는 중입니다. 손가락이 닿아 있으면 뗄 때까지 기다려요.
  let waiting = false;
  let held = false;
  let locked = false;
  let stream: WheelStream | null = null;
  let arm: WheelArm | null = null;
  // 키로 떠난 길이면 도착했을 때 포커스 자리를 잡아 줍니다.
  let keyed = false;
  const listeners = new Set<() => void>();

  const paint = () => {
    if (!frameId) frameId = requestAnimationFrame(frame);
  };

  function frame(now: number) {
    frameId = 0;
    if (tween) {
      pos = tweenPos(tween.from, tween.to, now - tween.start, tween.ms);
      if (pos === tween.to) tween = null;
      else paint();
    }
    if (pos === shown) return;
    shown = pos;
    for (const listener of listeners) listener();
  }

  function afterIdle() {
    waiting = false;
    settling = false;
    // 벽에 닿아 자리에 멈췄으면 그 장면에 머뭅니다.
    if (reduced() || stops.includes(pos)) return;
    const target = tweenTarget(pos, dir);
    if (target) play(target.to, target.ms);
  }

  function waitIdle() {
    waiting = true;
    clearTimeout(idle);
    if (!held) idle = setTimeout(afterIdle, idleMs);
  }

  function hold(down: boolean) {
    held = down;
    if (down) clearTimeout(idle);
    else if (waiting) waitIdle();
  }

  function play(to: number, ms: number) {
    clearTimeout(idle);
    waiting = false;
    dir = Math.sign(to - pos) || dir;
    if (reduced()) {
      tween = null;
      pos = to;
    } else {
      tween = { from: pos, to, start: performance.now(), ms };
    }
    paint();
  }

  function input(delta: number) {
    if (delta === 0 || locked) return;
    keyed = false;
    dir = Math.sign(delta);
    if (reduced()) {
      const target = settling ? null : tweenTarget(pos, dir);
      settling = true;
      if (target) pos = target.to;
    } else {
      tween = null;
      pos = clampPos(pos + delta);
    }
    waitIdle();
    paint();
  }

  function wheel(delta: number, at = performance.now()) {
    // 손을 뗀 소식을 못 받았어도(요소가 사라진 경우) 휠은 움직여야 합니다.
    held = false;
    arm = armWheel(arm, delta, at);
    if (arm.sum < wheelSlopPx) return;
    const gated = gateWheel(stream, pos, delta, at);
    stream = gated.stream;
    input(gated.delta);
  }

  function goTo(stop: number) {
    if (locked) return;
    const index = Math.min(lastStop, Math.max(0, stop));
    if ((tween?.to ?? pos) !== stops[index]) play(stops[index], legMs(pos, index));
  }

  function step(direction: number) {
    const stop = nextStop(tween?.to ?? pos, direction);
    if (stop !== null) goTo(stop);
  }

  function land(at: number) {
    clearTimeout(idle);
    waiting = false;
    tween = null;
    pos = at;
    // 구독자에게 지금 바로 알립니다. 다음 프레임이면 그 사이에 열린 메뉴까지 닫혀요.
    frame(0);
  }

  function lock(on: boolean) {
    locked = on;
    if (on) land(0);
  }

  function attach() {
    const blocked = () => document.querySelector("dialog[open], .context-menu") !== null;

    const onWheel = (event: WheelEvent) => {
      // 옆으로 미는 트랙패드에 섞여 오는 작은 세로 값은 장면을 넘기지 않습니다.
      if (event.ctrlKey || event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY) || blocked() || ownsScroll(event.target)) return;
      event.preventDefault();
      wheel(event.deltaY * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? innerHeight : 1), event.timeStamp);
    };

    let touchY: number | null = null;
    let touchMoved = false;
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches.length === 1 && !blocked() && !ownsScroll(event.target) ? event.touches[0].clientY : null;
      touchMoved = false;
      hold(touchY !== null);
    };
    const onTouchMove = (event: TouchEvent) => {
      if (touchY === null) return;
      // 길게 눌러 메뉴가 뜨면 그 뒤의 손가락은 메뉴 몫입니다.
      if (event.touches.length !== 1 || blocked()) {
        touchY = null;
        hold(false);
        return;
      }
      const y = event.touches[0].clientY;
      if (!touchMoved && Math.abs(y - touchY) < touchSlop) return;
      touchMoved = true;
      event.preventDefault();
      input(touchY - y);
      touchY = y;
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length > 0) return;
      touchY = null;
      hold(false);
    };

    // 지도 화병처럼 화살표를 직접 쓰는 곳은 preventDefault로 먼저 가져갑니다. 창에서 듣기 때문에 그 뒤에 옵니다.
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || blocked()) return;
      if (inside(event.target, ownInput) || inside(event.target, typing)) return;
      // 키로 가는 중에는 모든 장면이 잠겨 탭이 머리로 튀어요. 바로 도착시켜, 이 탭이 도착한 장면 안으로 들어가게 합니다. React가 잠금을 푼 다음(마이크로태스크)에 자리를 잡아요.
      if (event.key === "Tab" && keyed && tween && focusLost()) {
        land(tween.to);
        queueMicrotask(rehome);
        return;
      }
      if (event.key === "PageDown" || event.key === "ArrowDown") step(1);
      else if (event.key === "PageUp" || event.key === "ArrowUp") step(-1);
      else if (event.key === " " && !inside(event.target, control)) step(event.shiftKey ? -1 : 1);
      else if (event.key === "Home") goTo(0);
      else if (event.key === "End") goTo(lastStop);
      else return;
      keyed = true;
      event.preventDefault();
    };

    const onFocus = (event: FocusEvent) => {
      if (!(event.target instanceof Element)) return;
      const scene = event.target.closest<HTMLElement>("[data-scene]");
      // 흐르는 동안 들어온 포커스는 가던 길을 되돌리지 않습니다. 도착한 뒤 자리는 rehome이 잡아요.
      if (scene && !tween) goTo(Number(scene.dataset.scene));
    };

    // Chrome은 방금 잠긴 요소에서 다음 프레임까지도 포커스를 안 거둘 때가 있어 잠겼는지까지 봅니다.
    const focusLost = () => {
      const active = document.activeElement;
      return !active || active === document.body || active.closest("[inert]") !== null;
    };
    // 떠난 장면이 잠기면 포커스가 갈 곳을 잃어요. 다음 탭이 이 장면으로 들어가도록 장면에 잠깐 둡니다. 늘 포커스를 받게 두면 WebKit에서 클릭이 장면에 포커스를 줘요.
    const rehome = () => {
      if (!focusLost()) return;
      const scene = document.querySelector<HTMLElement>(`[data-scene="${liveScene(pos)}"]`);
      if (!scene) return;
      scene.tabIndex = -1;
      scene.focus({ preventScroll: true });
      scene.addEventListener("blur", () => scene.removeAttribute("tabindex"), { once: true });
      scene.addEventListener("pointerdown", () => scene.blur(), { once: true });
    };
    const onArrive = () => {
      if (!keyed || tween || !stops.includes(pos)) return;
      keyed = false;
      requestAnimationFrame(rehome);
    };

    addEventListener("wheel", onWheel, { passive: false });
    addEventListener("touchstart", onTouchStart, { passive: true });
    addEventListener("touchmove", onTouchMove, { passive: false });
    addEventListener("touchend", onTouchEnd);
    addEventListener("touchcancel", onTouchEnd);
    addEventListener("keydown", onKey);
    addEventListener("focusin", onFocus);
    listeners.add(onArrive);
    // 방에서 돌아오면 누른 링크가 사라져 포커스가 없습니다. 맨 처음 켤 때의 첫 탭은 그대로 머리로 갑니다.
    if (pos > 0) requestAnimationFrame(rehome);
    if (import.meta.env.DEV) (window as unknown as { __engine?: Engine }).__engine = engine;
    return () => {
      removeEventListener("wheel", onWheel);
      removeEventListener("touchstart", onTouchStart);
      removeEventListener("touchmove", onTouchMove);
      removeEventListener("touchend", onTouchEnd);
      removeEventListener("touchcancel", onTouchEnd);
      removeEventListener("keydown", onKey);
      removeEventListener("focusin", onFocus);
      listeners.delete(onArrive);
      clearTimeout(idle);
      cancelAnimationFrame(frameId);
      frameId = 0;
      tween = null;
      waiting = false;
      held = false;
    };
  }

  const engine: Engine = {
    get pos() {
      return pos;
    },
    get dir() {
      return dir;
    },
    get target() {
      if (tween) return tween.to;
      return stops.includes(pos) ? pos : (tweenTarget(pos, dir)?.to ?? pos);
    },
    get moving() {
      return tween !== null || waiting;
    },
    arrive: () => land(engine.target),
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    input,
    wheel,
    hold,
    step,
    goTo,
    lock,
    attach,
  };
  return engine;
}

export const EngineContext = createContext<Engine | null>(null);

export function useEngine(): Engine {
  const engine = useContext(EngineContext);
  if (!engine) throw new Error("useEngine은 EngineContext 안에서만 씁니다.");
  return engine;
}

// 장면의 움직임은 여기서 DOM에 바로 씁니다. pos가 바뀐 프레임에만, 프레임마다 한 번 불러요. React 상태는 건드리지 않습니다.
// 다시 그려져 새 줄이 생겨도 자리를 맞추도록 그릴 때마다 한 번 더 부릅니다.
export function useScene(write: (pos: number) => void) {
  const engine = useEngine();
  const latest = useRef(write);
  useLayoutEffect(() => {
    latest.current = write;
    write(engine.pos);
  });
  useLayoutEffect(() => engine.subscribe(() => latest.current(engine.pos)), [engine]);
}

// pos가 범위를 넘나들 때만 다시 그립니다. inert, pointer-events, 한 번만 도는 애니메이션에 씁니다.
export function useBetween(from: number, to: number): boolean {
  const engine = useEngine();
  return useSyncExternalStore(engine.subscribe, () => engine.pos >= from && engine.pos <= to);
}

export function useLiveScene(): number {
  const engine = useEngine();
  return useSyncExternalStore(engine.subscribe, () => liveScene(engine.pos));
}

// 흘러가는 동안 닿을 장면이 아니면 잠급니다. 지나치는 장면이 두 번째 클릭이나 포커스를 받으면 엉뚱한 곳으로 가요.
export const sceneOpen = (engine: Engine, index: number) => liveScene(engine.pos) === index && (!engine.moving || liveScene(engine.target) === index);

// 장면 맨 바깥 요소에 펼칩니다: <section className="scene scene-table" {...useSceneGate(2)}>
export function useSceneGate(index: number) {
  const engine = useEngine();
  const { show } = scenes[index];
  const visible = useBetween(show[0], show[1]);
  const live = useSyncExternalStore(engine.subscribe, () => sceneOpen(engine, index));
  return { "data-scene": index, "data-show": visible, inert: !live };
}

export type HomeActions = {
  // 고르면 첫 화면으로 돌아가 패널을 엽니다.
  selectRoom: (id: string | null) => void;
  focusThing: (roomId: string, thingId: string) => void;
  openRoom: (id: string) => void;
  openSweep: () => void;
  openNew: () => void;
  openMenu: () => void;
  // 데스크톱 앱에는 목록 파일 가져오기가 없어 null입니다.
  importList: (() => void) | null;
  addSample: () => void;
  clearSamples: () => void;
  roomMenu: OpenRoomMenu;
  toggleDone: (id: string, done: boolean) => void;
};

export type SceneProps = {
  rooms: Room[];
  stats: Map<string, RoomStat>;
  now: number;
  lastSweepAt: number | null;
  returnTo: string | null;
  actions: HomeActions;
};
