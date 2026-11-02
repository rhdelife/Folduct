import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type RefObject } from "react";
import { hash, stageUnit, toPx, vaseHalf, vaseUnit, type View } from "../../domain/sky";
import { flightsFor, notebookGuide, type Card, type Flight, type HeroNode, type NotebookGuide } from "../../domain/heroLayout";
import { cubicOut, range, useBetween, useEngine, useScene } from "./engine";

// 첫 화면의 움직임. 처음 켤 때의 등장은 시계로, 첫 스크롤은 pos로 그립니다(되감아도 그대로 돌아와요).

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const easeInOut = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// 첫 스크롤의 pos 구간. 띠가 모이는 동안 공책이 올라와 자리를 잡고, 잠깐 멈췄다가 왼쪽부터 차례로 공책에 떨어져 사라집니다.
const beltFrom = 90;
const beltSpan = 230;
const dropFrom = 675;
const dropSpread = 248;
const dropSpan = 114;
const vanishAt = [1063, 1074, 1087];
const vanishSpan = 10;
export const cardsGone = 1097;
// 되감을 때 화병은 첫 화면이 가까워지면 돌아옵니다(되감기는 끝으로 갈수록 느려서 맨 위까지 기다리면 한참 늦어요).
const vasesBackAt = 260;

export type Pose = { x: number; y: number; rot: number; scale: number; opacity: number };

// 쉬는 자리에서의 거리로 돌려줍니다. rot은 종이가 쉴 때의 기울기(rest)에 더하는 값이에요.
export function cardPose(pos: number, flight: Flight, count: number, rest: number, id: string): Pose {
  const toBelt = easeInOut(range(pos, beltFrom + hash(id, 31) * 60, beltFrom + hash(id, 31) * 60 + beltSpan));
  const start = dropFrom + (count > 1 ? (flight.slot / (count - 1)) * dropSpread : 0);
  const toLand = cubicOut(range(pos, start, start + dropSpan));
  const { rest: from, belt, land } = flight;
  const onBelt = { x: lerp(from.x, belt.x, toBelt), y: lerp(from.y, belt.y, toBelt), rot: lerp(rest, belt.rot, toBelt), scale: lerp(1, belt.scale, toBelt) };
  return {
    x: lerp(onBelt.x, land.x, toLand) - from.x,
    y: lerp(onBelt.y, land.y, toLand) - from.y,
    rot: lerp(onBelt.rot, land.rot, toLand) - rest,
    scale: lerp(onBelt.scale, land.scale, toLand),
    opacity: 1 - range(pos, vanishAt[flight.section], vanishAt[flight.section] + vanishSpan),
  };
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

// 오른쪽 위 화면 밖으로 날아갑니다.
export function exitFrames(rest: Pt, half: number, view: View): Keyframe[] {
  const to = { x: view.w + half * 2, y: -2.5 * half * 2 };
  const via = { x: lerp(rest.x, to.x, 0.82), y: to.y - view.h * 0.06 };
  return Array.from({ length: 17 }, (_, i) => {
    const u = i / 16;
    const at = bezier(rest, via, to, cubicOut(u));
    return { translate: `${at.x - rest.x}px ${at.y - rest.y}px`, rotate: `${lerp(0, 24, Math.min(1, u * 3)) - 18 * u}deg` };
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

export function useHeroMotion(canvas: RefObject<HTMLElement | null>, cards: Card[], nodes: HeroNode[], view: View, selectedId: string | null, measureNotebook: () => NotebookGuide | null) {
  const engine = useEngine();
  const atRest = useBetween(0, 5);
  const vasesHome = useSyncExternalStore(engine.subscribe, () => engine.pos <= (engine.dir < 0 ? vasesBackAt : 5));
  const shown = useMemo(() => cards.filter((card) => !card.extra), [cards]);
  const guide = useRef<NotebookGuide | null>(null);
  const flights = useMemo(() => flightsFor(shown, view, guide.current ?? notebookGuide(view)), [shown, view]);
  const flown = useRef<Map<string, Flight>>(flights);
  useLayoutEffect(() => {
    flown.current = flights;
  }, [flights]);

  const els = useRef<HTMLElement[]>([]);
  const papers = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const root = canvas.current!;
    els.current = [...root.querySelectorAll<HTMLElement>(".paper")];
    papers.current = root.querySelector(".papers");
  });

  // 공책 장면이 실제 글자 자리를 알려 주면 그 자리로 내립니다. 공책이 올라오기 전, 스크롤이 시작될 때 한 번 재요.
  useEffect(() => {
    if (atRest) return;
    const measured = measureNotebook();
    if (!measured) return;
    guide.current = measured;
    flown.current = flightsFor(shown, view, measured);
  }, [atRest, shown, view]);

  const last = useRef(-1);
  useScene((pos) => {
    // 다 사라진 뒤로는 쓸 일이 없습니다.
    const done = pos >= cardsGone;
    if (papers.current) papers.current.dataset.gone = String(done);
    if (done && last.current >= cardsGone) return;
    last.current = pos;
    const count = flown.current.size;
    for (const el of els.current) {
      const id = el.dataset.card!;
      const flight = flown.current.get(id);
      if (!flight) continue;
      if (pos <= 0) {
        el.style.transform = "";
        el.style.opacity = "";
        continue;
      }
      const pose = cardPose(pos, flight, count, Number(el.dataset.rot), id);
      el.style.transform = `translate3d(${pose.x}px, ${pose.y}px, 0) rotate(${pose.rot}deg) scale(${pose.scale})`;
      el.style.opacity = pose.opacity < 1 ? String(pose.opacity) : "";
    }
  });

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

  // 첫 입력에 화병이 오른쪽 위로 날아가고, 되감으면 같은 길로 돌아옵니다. 스크롤과 무관하게 시계로 돌아요.
  const away = useRef(new Map<HTMLElement, Animation>());
  const wasHome = useRef(vasesHome);
  useEffect(() => {
    if (wasHome.current === vasesHome) return;
    wasHome.current = vasesHome;
    settle.current?.();
    if (reduced()) return;
    const root = canvas.current!;
    const unit = stageUnit(view) * vaseUnit;
    for (const { room, at, r } of nodes) {
      const lift = vaseOf(root, room.id)?.querySelector<HTMLElement>(".vase-lift");
      if (!lift) continue;
      const running = away.current.get(lift);
      if (running) {
        running.playbackRate = vasesHome ? -1 : 1;
        running.play();
      } else {
        const anim = lift.animate(exitFrames(toPx(at, view), vaseHalf(r) * unit, view), { duration: 620, delay: hash(room.id, 32) * 90, fill: "both" });
        anim.onfinish = () => {
          if (anim.playbackRate < 0) {
            anim.cancel();
            away.current.delete(lift);
          }
        };
        away.current.set(lift, anim);
        // 방에서 돌아와 처음 되감을 때는 떠난 적이 없으니, 끝에서부터 틀어 같은 길로 옵니다.
        if (vasesHome) anim.reverse();
      }
    }
  }, [vasesHome]);

  return { atRest, vasesHome };
}
