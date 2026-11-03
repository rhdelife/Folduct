import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { stageUnit, toPx, vaseHalf, vaseUnit, type View } from "../../domain/sky";
import { flightsFor, rowMetrics, type Card, type Flight, type HeroNode } from "../../domain/heroLayout";
import { range, rowRest, useBetween, useEngine, useScene } from "./engine";

// 첫 화면의 움직임. 처음 켤 때의 등장은 시계로, 첫 스크롤은 pos로 그립니다(되감아도 그대로 돌아와요).

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const easeInOut = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// 첫 스크롤: 0에서 rowRest까지 종이가 한 줄로 모여 쉽니다.
const gatherSpread = 180;

export type Pose = { x: number; y: number; rot: number; scale: number; opacity: number };

// 쉬는 자리에서의 거리로 돌려줍니다. rot은 종이가 쉴 때의 기울기에 더하는 값이에요.
// 줄에만 있는 종이는 제자리에서 나타납니다.
export function rowOnlyPose(pos: number, { to }: Flight): Pose {
  return { x: to.x, y: to.y, rot: to.rot, scale: to.scale, opacity: range(pos, rowRest * 0.6, rowRest) };
}

export function cardPose(pos: number, { rest, to, stagger }: Flight): Pose {
  const start = stagger * gatherSpread;
  const u = easeInOut(range(pos, start, start + rowRest - gatherSpread));
  return { x: (to.x - rest.x) * u, y: (to.y - rest.y) * u, rot: to.rot * u, scale: lerp(1, to.scale, u), opacity: 1 };
}

// 2차 베지어 위의 점들을 키프레임으로 씁니다. 합성 스레드에서 도니 비행 중에 JS가 돌지 않아요.
type Pt = { x: number; y: number };
const bezier = (a: Pt, b: Pt, c: Pt, s: number): Pt => ({ x: (1 - s) ** 2 * a.x + 2 * (1 - s) * s * b.x + s * s * c.x, y: (1 - s) ** 2 * a.y + 2 * (1 - s) * s * b.y + s * s * c.y });

// 왼쪽 아래 화면 밖에서 떠올라 수평으로 눕듯 내려앉습니다. 오를 땐 기울고, 내릴 땐 고개를 들며, 긴 주기로 살짝 흔들려요.
export function arrivalFrames(rest: Pt, half: number, view: View, ms: number): Keyframe[] {
  const from = { x: -1.2 * half * 2, y: view.h + 1.2 * half * 2 };
  const via = { x: lerp(from.x, rest.x, 0.4), y: rest.y };
  return Array.from({ length: 29 }, (_, i) => {
    const u = i / 28;
    const t = u * ms;
    const at = bezier(from, via, rest, Math.sin((u * Math.PI) / 2));
    const flare = range(u, 0.54, 1);
    const lean = 20 * (1 - flare) * (1 - flare) - 7 * Math.sin(Math.PI * flare);
    const sway = -3 * Math.cos((2 * Math.PI * (t + 14)) / 1400) * (1 - range(t, ms - 300, ms));
    return { translate: `${at.x - rest.x}px ${at.y - rest.y}px`, rotate: `${lean + sway}deg` };
  });
}

// 종이 한 장의 등장: 자기 방 화병에서 튀어나와 살짝 지나쳤다가 제자리에 앉습니다.
export function spillFrames(dx: number, dy: number, kick: number): Keyframe[] {
  return [
    { offset: 0, opacity: 0, translate: `${dx}px ${dy}px`, scale: "0.2", rotate: `${2 * kick}deg`, easing: "cubic-bezier(.16,1,.3,1)" },
    { offset: 0.12, opacity: 1 },
    { offset: 0.72, translate: `${-0.06 * dx}px ${-0.06 * dy}px`, scale: "1.06", rotate: `${-0.2 * kick}deg`, easing: "ease-in-out" },
    { offset: 1, opacity: 1, translate: "0px 0px", scale: "1", rotate: "0deg" },
  ];
}

const vaseStep = (count: number) => Math.min(220, 1500 / Math.max(1, count));
const flightMs = 1600;
const vaseFrom = 150;
const spillOverlap = 300;
const spillStep = 45;
const spillMs = 760;

type Scene = { root: HTMLElement; cards: Card[]; nodes: HeroNode[]; view: View };

function vaseOf(root: HTMLElement, id: string) {
  return root.querySelector<HTMLElement>(`.room-node[data-room-id="${CSS.escape(id)}"]`);
}

function playEntrance({ root, cards, nodes, view }: Scene): { anims: Animation[]; endsAt: number } {
  const anims: Animation[] = [];
  const add = (el: Element | null | undefined, frames: Keyframe[], options: KeyframeAnimationOptions) => {
    if (el) anims.push(el.animate(frames, { fill: "backwards", ...options }));
  };
  // 화병이 먼저 날아와 자리를 잡고, 그 화병에서 파일이 흩어져 나옵니다.
  const step = vaseStep(nodes.length);
  const unit = stageUnit(view) * vaseUnit;
  const landed = new Map<string, number>();
  nodes.forEach(({ room, at, r }, i) => {
    const node = vaseOf(root, room.id);
    const delay = vaseFrom + i * step;
    add(node?.querySelector(".vase-lift"), arrivalFrames(toPx(at, view), vaseHalf(r) * unit, view, flightMs), { duration: flightMs, delay });
    add(node?.querySelector(".vase-tag"), [{ opacity: 0 }, { opacity: 1 }], { duration: 320, delay: delay + flightMs - 200, easing: "ease-out" });
    landed.set(room.id, delay + flightMs - spillOverlap);
  });
  let endsAt = vaseFrom + Math.max(0, nodes.length - 1) * step + flightMs;
  const spilled = new Map<string, number>();
  const papers = [...root.querySelectorAll<HTMLElement>(".paper")];
  cards.forEach((card, index) => {
    const home = nodes.find((node) => node.room.id === card.room.id);
    if (!home) return;
    const rest = toPx(card, view);
    const origin = toPx(home.at, view);
    const turn = spilled.get(card.room.id) ?? 0;
    spilled.set(card.room.id, turn + 1);
    const delay = (landed.get(card.room.id) ?? 0) + turn * spillStep;
    add(papers[index], spillFrames(origin.x - rest.x, origin.y - rest.y, card.kick), { duration: spillMs, delay });
    endsAt = Math.max(endsAt, delay + spillMs);
  });
  return { anims, endsAt: endsAt + 100 };
}

// 처음 켤 때 한 번만. 방에서 돌아오면 다시 틀지 않습니다.
let entrancePlayed = false;

export function useHeroMotion(canvas: RefObject<HTMLElement | null>, cards: Card[], rowOnly: Card[], nodes: HeroNode[], view: View, selectedId: string | null) {
  const engine = useEngine();
  const atRest = useBetween(0, 5);
  const atRow = useBetween(rowRest - 5, rowRest + 5);
  const shown = useMemo(() => cards.filter((card) => !card.extra), [cards]);
  const flown = useRef<Map<string, Flight>>(new Map());
  const row = useRef({ offset: 0, max: 0 });
  const [track, setTrack] = useState<{ max: number; y: number } | null>(null);

  const els = useRef<HTMLElement[]>([]);
  const papers = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const root = canvas.current!;
    els.current = [...root.querySelectorAll<HTMLElement>(".paper")];
    papers.current = root.querySelector(".papers");
  });

  const write = (pos: number) => {
    if (pos <= 0) row.current.offset = 0;
    // 밀어 둔 줄은 제자리로 돌아가는 동안 함께 풀립니다.
    if (papers.current) papers.current.style.translate = row.current.offset ? `${-row.current.offset * easeInOut(range(pos, 0, rowRest))}px 0` : "";
    for (const el of els.current) {
      const flight = flown.current.get(el.dataset.card!);
      if (!flight) continue;
      if (pos <= 0) {
        el.style.transform = "";
        el.style.opacity = flight.rowOnly ? "0" : "";
        el.style.zIndex = "";
        continue;
      }
      const pose = flight.rowOnly ? rowOnlyPose(pos, flight) : cardPose(pos, flight);
      el.style.transform = `translate3d(${pose.x}px, ${pose.y}px, 0) rotate(${pose.rot}deg) scale(${pose.scale})`;
      el.style.opacity = pose.opacity < 1 ? String(pose.opacity) : "";
      // 더미에서는 최근에 작업한 왼쪽 종이가 맨 위에 옵니다.
      el.style.zIndex = String(flown.current.size - flight.slot);
    }
  };
  useScene(write);

  // 스크롤이 시작될 때 현관 줄 아래로 줄의 자리를 잡고 바로 그립니다. 쉬는 동안에는 아무 일도 하지 않아요.
  useEffect(() => {
    if (atRest) return;
    const door = canvas.current!.closest(".sky-layout")?.querySelector<HTMLElement>(".doorstep");
    flown.current = flightsFor([...shown, ...rowOnly], nodes, view, door ? door.offsetTop + door.offsetHeight : 0);
    const { overflow, bottom } = rowMetrics(flown.current, view);
    row.current = { max: overflow, offset: Math.min(row.current.offset, overflow) };
    setTrack(overflow > 0 ? { max: overflow, y: bottom } : null);
    write(engine.pos);
  }, [atRest, shown, rowOnly, nodes, view]);

  // 줄을 옆으로 밉니다. 실제로 간 자리를 돌려줘요.
  const scrollRow = (by: (offset: number) => number) => {
    row.current.offset = Math.max(0, Math.min(row.current.max, by(row.current.offset)));
    write(engine.pos);
    return row.current.offset;
  };

  // 등장. 휠, 키, 누르기 중 무엇이든 들어오면 바로 끝난 모습으로 갑니다.
  const settle = useRef<(() => void) | null>(null);
  const hasScene = nodes.length > 0;
  useLayoutEffect(() => {
    if (entrancePlayed || !hasScene) return;
    if (reduced() || engine.pos !== 0 || selectedId) {
      entrancePlayed = true;
      return;
    }
    const root = canvas.current!;
    root.classList.add("entering");
    const { anims, endsAt } = playEntrance({ root, cards: shown, nodes, view });
    const stop = () => {
      clearTimeout(timer);
      for (const name of inputs) removeEventListener(name, finish, true);
      for (const anim of anims) anim.cancel();
      root.classList.remove("entering");
      settle.current = null;
    };
    const finish = () => {
      entrancePlayed = true;
      stop();
    };
    const inputs = ["wheel", "keydown", "pointerdown", "touchstart"] as const;
    for (const name of inputs) addEventListener(name, finish, { capture: true, passive: true });
    const timer = setTimeout(finish, endsAt);
    settle.current = finish;
    // StrictMode의 두 번째 실행에서 다시 틀 수 있게 여기서는 표시하지 않습니다.
    return stop;
  }, [hasScene]);

  // 메뉴처럼 입력 없이 떠나도 등장을 끝냅니다.
  useEffect(() => {
    if (!atRest) settle.current?.();
  }, [atRest]);

  return { atRest, atRow, track, row, scrollRow };
}
