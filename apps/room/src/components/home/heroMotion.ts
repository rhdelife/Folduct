import { useLayoutEffect, useRef, type RefObject } from "react";
import { ductLength, ductMouth } from "../../art/duct";
import { roomUsage } from "../../domain/care";
import { stageUnit, toPx, vaseHalf, vaseUnit, type View } from "../../domain/sky";
import type { Card, HeroNode } from "../../domain/heroLayout";
import { range, useEngine } from "./engine";

// 첫 화면의 움직임: 처음 켤 때 주름관이 날아와 서고, 그 입에서 파일이 제 칸으로 나옵니다.

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

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

// 종이 한 장의 등장: 자기 방 주름관의 입에서 튀어나와 살짝 지나쳤다가 제자리에 앉습니다.
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
  // 주름관이 먼저 날아와 자리를 잡고, 그 입에서 파일이 흩어져 나옵니다.
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
    const center = toPx(home.at, view);
    const mouth = ductMouth(home.room.face.shape, ductLength(roomUsage(home.room).totalBytes));
    const box = vaseHalf(home.r) * unit * 2;
    const origin = { x: center.x + mouth.x * box, y: center.y + mouth.y * box };
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

export function useHeroMotion(canvas: RefObject<HTMLElement | null>, cards: Card[], nodes: HeroNode[], view: View, selectedId: string | null) {
  const engine = useEngine();
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
    const { anims, endsAt } = playEntrance({ root, cards, nodes, view });
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
}
