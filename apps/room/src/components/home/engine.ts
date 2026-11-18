/// <reference types="vite/client" />
import { createContext, useContext, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { Room } from "../../domain/model";
import type { RoomStat } from "../../domain/sky";
import type { OpenRoomMenu } from "../ContextMenu";

// 집 화면은 문서 스크롤이 없습니다. 숫자 하나(pos)가 첫 화면을 움직여요.
// 문턱을 넘은 휠과 손가락은 pos에 그대로 더하고, 입력이 140ms 멈추면 마지막 방향의 쉼터까지 cubic-out으로 흘러갑니다.
// 종이가 한 줄로 모여 쉬는 자리. 쉼터는 맨 위와 여기 둘뿐이에요.
export const rowRest = 640;
const rests: readonly number[] = [0, rowRest];
export const travelMs = 1000;
export const idleMs = 140;
const touchSlop = 12;

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
export const range = (pos: number, a: number, b: number) => clamp01((pos - a) / (b - a));
export const cubicOut = (u: number) => 1 - (1 - u) ** 3;

export const clampPos = (pos: number) => Math.min(rowRest, Math.max(0, pos));

// 방향으로 pos를 넘어선 첫 쉼터. 가까운 쉼터로 되돌아가는 일은 없습니다.
export function nextRest(pos: number, dir: number): number | null {
  if (dir > 0) return rests.find((rest) => rest > pos) ?? null;
  if (dir < 0) return rests.filter((rest) => rest < pos).at(-1) ?? null;
  return null;
}

export function tweenPos(from: number, to: number, elapsed: number, ms: number): number {
  return elapsed >= ms ? to : from + (to - from) * cubicOut(Math.max(0, elapsed) / ms);
}

// 마우스를 살짝 건드린 값까지 받으면 멈추면서 쉼터로 흘러가 화면이 저절로 움직입니다. 한 방향으로 이만큼 모여야 미는 것으로 봅니다.
// 한 번 넘으면 그 흐름이 이어지는 동안은 그대로 통과합니다. 잠깐 멈추거나 방향이 바뀌면 다시 모아요.
export type WheelArm = { at: number; dir: number; sum: number };
export const wheelSlopPx = 60;
const armMs = 300;

export function armWheel(prev: WheelArm | null, delta: number, now: number): WheelArm {
  const dir = Math.sign(delta);
  const going = prev !== null && prev.dir === dir && now - prev.at < armMs;
  return { at: now, dir, sum: (going ? prev.sum : 0) + Math.abs(delta) };
}

const ownInput = ".sky-panel, dialog, [data-own-wheel], .context-menu";
const typing = "input, textarea, select, [contenteditable]";
const control = `${typing}, button, a, summary, [role="button"]`;
const inside = (target: EventTarget | null, selector: string) => target instanceof Element && target.closest(selector) !== null;
// 스크롤할 게 없는 목록 위에서는 휠이 첫 화면을 움직입니다. 안 그러면 멈춘 듯 보여요.
const ownsScroll = (target: EventTarget | null) => {
  const own = target instanceof Element ? target.closest<HTMLElement>(ownInput) : null;
  return own !== null && (!own.matches("[data-own-wheel]") || own.scrollHeight > own.clientHeight);
};
export const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
// 아래 서랍장 장면으로 내려가 있나요.
export const awayFromHome = () => (document.querySelector<HTMLElement>(".home")?.dataset.view ?? "home") !== "home";

export type Engine = {
  readonly pos: number;
  // 지금 향하는 자리. 멈춰 있으면 지금 자리예요.
  readonly target: number;
  subscribe: (listener: () => void) => () => void;
  input: (delta: number) => void;
  wheel: (delta: number, at?: number) => void;
  // 손가락이 닿아 있는 동안은 자동으로 흘러가지 않습니다.
  hold: (down: boolean) => void;
  step: (dir: number) => void;
  goTo: (to: number) => void;
  // 방이 하나도 없으면 움직일 게 없습니다. 맨 위에 그대로 둡니다.
  lock: (on: boolean) => void;
  attach: () => () => void;
};

export function createEngine(): Engine {
  let pos = 0;
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
  let arm: WheelArm | null = null;
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
    if (reduced() || rests.includes(pos)) return;
    const to = nextRest(pos, dir);
    if (to !== null) play(to);
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

  function play(to: number) {
    clearTimeout(idle);
    waiting = false;
    dir = Math.sign(to - pos) || dir;
    if (reduced()) {
      tween = null;
      pos = to;
    } else {
      tween = { from: pos, to, start: performance.now(), ms: travelMs };
    }
    paint();
  }

  function input(delta: number) {
    if (delta === 0 || locked) return;
    dir = Math.sign(delta);
    if (reduced()) {
      const to = settling ? null : nextRest(pos, dir);
      settling = true;
      if (to !== null) pos = to;
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
    if (arm.sum >= wheelSlopPx) input(delta);
  }

  function goTo(to: number) {
    if (!locked && (tween?.to ?? pos) !== to) play(to);
  }

  function step(direction: number) {
    const to = nextRest(tween?.to ?? pos, direction);
    if (to !== null) goTo(to);
  }

  function lock(on: boolean) {
    locked = on;
    if (!on) return;
    clearTimeout(idle);
    waiting = false;
    tween = null;
    pos = 0;
    frame(0);
  }

  function attach() {
    const blocked = () => document.querySelector("dialog[open], .context-menu") !== null;

    const onWheel = (event: WheelEvent) => {
      // 옆으로 미는 트랙패드에 섞여 오는 작은 세로 값은 움직이지 않습니다.
      // Shift를 누른 휠은 줄을 옆으로 밉니다.
      if (event.ctrlKey || event.shiftKey || event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY) || blocked() || ownsScroll(event.target)) return;
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

    // 지도 주름관처럼 화살표를 직접 쓰는 곳은 preventDefault로 먼저 가져갑니다. 창에서 듣기 때문에 그 뒤에 옵니다.
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || blocked()) return;
      if (inside(event.target, ownInput) || inside(event.target, typing)) return;
      if (event.key === "PageDown" || event.key === "ArrowDown") step(1);
      else if (event.key === "PageUp" || event.key === "ArrowUp") step(-1);
      else if (event.key === " " && !inside(event.target, control)) step(event.shiftKey ? -1 : 1);
      else if (event.key === "Home") goTo(0);
      else if (event.key === "End") goTo(rowRest);
      else return;
      event.preventDefault();
    };

    addEventListener("wheel", onWheel, { passive: false });
    addEventListener("touchstart", onTouchStart, { passive: true });
    addEventListener("touchmove", onTouchMove, { passive: false });
    addEventListener("touchend", onTouchEnd);
    addEventListener("touchcancel", onTouchEnd);
    addEventListener("keydown", onKey);
    if (import.meta.env.DEV) (window as unknown as { __engine?: Engine }).__engine = engine;
    return () => {
      removeEventListener("wheel", onWheel);
      removeEventListener("touchstart", onTouchStart);
      removeEventListener("touchmove", onTouchMove);
      removeEventListener("touchend", onTouchEnd);
      removeEventListener("touchcancel", onTouchEnd);
      removeEventListener("keydown", onKey);
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
    get target() {
      if (tween) return tween.to;
      return rests.includes(pos) ? pos : (nextRest(pos, dir) ?? pos);
    },
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

export type HomeActions = {
  selectRoom: (id: string | null) => void;
  focusThing: (roomId: string, thingId: string) => void;
  openRoom: (id: string) => void;
  openSweep: () => void;
  // 방에 들어가지 않고 파일을 봅니다.
  openFile: (roomId: string, thingId: string) => void;
  // 파일을 다른 방 폴더로 옮겨요. 데스크톱 앱에서만 있고, 아니면 null이에요.
  moveThing: ((roomId: string, thingId: string, toRoomId: string) => void) | null;
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
  actions: HomeActions;
};
