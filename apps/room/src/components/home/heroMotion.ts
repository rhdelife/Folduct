import { useLayoutEffect, type RefObject } from "react";
import { toPx, type View } from "../../domain/sky";
import type { Card, HeroFrodo } from "../../domain/heroLayout";
import { cue, homeActor } from "../useFrodo";
import { useEngine } from "./engine";

// 첫 화면의 움직임: 처음 켤 때 프로도가 방을 하나씩 받아먹으며 그만큼 길어지고, 방을 고르면 입에서 그 방 파일이 제 칸으로 나옵니다.

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
// 종이 한 장의 등장: 자기 방 주름관의 입에서 튀어나와 살짝 지나쳤다가 제자리에 앉습니다.
export function spillFrames(dx: number, dy: number, kick: number): Keyframe[] {
  return [
    { offset: 0, opacity: 0, translate: `${dx}px ${dy}px`, scale: "0.2", rotate: `${2 * kick}deg`, easing: "cubic-bezier(.16,1,.3,1)" },
    { offset: 0.12, opacity: 1 },
    { offset: 0.72, translate: `${-0.06 * dx}px ${-0.06 * dy}px`, scale: "1.06", rotate: `${-0.2 * kick}deg`, easing: "ease-in-out" },
    { offset: 1, opacity: 1, translate: "0px 0px", scale: "1", rotate: "0deg" },
  ];
}

// 한 방을 받아먹는 데 드는 시간: 입을 벌리고(gulpMs) 삼킨 뒤 그 방 용량만큼 받침에서 솟아요(growMs).
const peekMs = 520;
const gulpMs = 320;
const growMs = 380;
const eatFrom = 200;
// 고른 뒤: 카메라가 다가가고(styles.css .sky-camera, 1000ms), 멈추면 프로도가 웅크렸다가 파일을 하나씩 뱉어요.
// 다가가는 1초 동안은 카메라만 움직입니다. 웅크리기·표정·뱉기는 카메라가 멈춘 뒤에 시작해요.
// 전에는 카메라가 멈추는 바로 그 프레임에 뱉기가 시작되고, 다가가는 중에 SVG 머리를 움직여 WebKit에서 한 번 끊겼어요.
// 멈춘 프레임을 피해 80ms 뒤에 시작합니다. styles.css --dur-focus(1000ms)와 맞춰요.
const windFrom = 1000 + 80;
const windUp = 420;
const spillFrom = windFrom + windUp;
// 파일이 많아도 다 나오는 데 1.6초를 넘지 않게 간격을 줄여요.
const spillStepFor = (count: number) => Math.min(110, 1600 / Math.max(1, count));
const spillMs = 1100;
// 머리를 한 번 부풀렸다 오므리는 데 걸리는 시간. 늘 오므린 채로 끝나 멈출 때 튀지 않아요.
const puffMs = 560;

type Play = { anims: Animation[]; endsAt: number; timers: number[] };
const player = (anims: Animation[]) => (el: Element | null | undefined, frames: Keyframe[], options: KeyframeAnimationOptions) => {
  if (el) anims.push(el.animate(frames, { fill: "backwards", ...options }));
};

// 처음 켤 때: 받침 자리에서 머리만 내민 프로도가 방을 하나씩 받아먹고, 먹을 때마다 그 방 용량만큼 솟아 몸이 길어져요. 먹은 방 이름이 옆 목록에 하나씩 나타나요.
// 받침 선 아래는 가려 두니(styles.css .entering .frodo-home) 아직 안 먹은 만큼의 몸은 보이지 않아요. 움직이는 건 translate 하나라 합성 스레드에서 돌아요.
function playEntrance(root: HTMLElement, frodo: HeroFrodo): Play {
  const anims: Animation[] = [];
  const timers: number[] = [];
  const add = player(anims);
  const floor = frodo.top + frodo.height;
  const { segs } = frodo;
  const step = gulpMs + growMs;
  const total = eatFrom + peekMs + segs.length * step + growMs;
  const at = (ms: number) => Math.min(1, ms / total);
  const frames: Keyframe[] = [{ offset: 0, translate: `0px ${frodo.height}px` }, { offset: at(eatFrom), translate: `0px ${frodo.height}px`, easing: "cubic-bezier(.2,.8,.3,1)" }];
  let rest = floor - segs[0].top;
  frames.push({ offset: at(eatFrom + peekMs), translate: `0px ${rest}px` });
  segs.forEach((seg, i) => {
    const from = eatFrom + peekMs + i * step;
    // 입을 크게 벌렸다 닫으며 삼켜요. 그 사이 몸은 멈춰 있어요.
    timers.push(window.setTimeout(() => cue(homeActor, { face: "wide", ms: gulpMs * 0.6 }), from));
    timers.push(window.setTimeout(() => cue(homeActor, { face: "shut", ms: gulpMs * 0.4 }), from + gulpMs * 0.6));
    frames.push({ offset: at(from + gulpMs), translate: `0px ${rest}px`, easing: "cubic-bezier(.3,1.4,.5,1)" });
    rest = i === segs.length - 1 ? 0 : floor - seg.bottom;
    frames.push({ offset: at(from + step), translate: `0px ${rest}px` });
    add(root.querySelector(`.room-node[data-room-id="${CSS.escape(seg.room.id)}"] .seg-tag`), [{ opacity: 0, translate: "-8px 0" }, { opacity: 1, translate: "0 0" }], { duration: growMs, delay: from + gulpMs, easing: "ease-out" });
  });
  frames.push({ offset: 1, translate: "0px 0px" });
  add(root.querySelector(".frodo-lift"), frames, { duration: total });
  add(root.querySelector(".frodo-floor"), [{ opacity: 0 }, { opacity: 1 }], { duration: 320, delay: total - 320, easing: "ease-out" });
  timers.push(window.setTimeout(() => cue(homeActor, { face: "happy", ms: 900 }), total));
  return { anims, endsAt: total + 100, timers };
}

// 고른 방: 프로도가 웅크렸다가 머리를 부풀리며 파일을 한 장씩 뱉고, 파일은 아래 칸에 앉습니다. 종이는 그린 순서대로 .paper예요.
// 몸짓도 여기서 직접 틀어요. CSS 클래스로 두면 끝날 때 머리가 부푼 채로 끊겨 튀어 보였어요.
function playSpill(root: HTMLElement, cards: Card[], frodo: HeroFrodo, view: View): Play & { spitting: number } {
  const anims: Animation[] = [];
  const add = player(anims);
  const origin = frodo.mouth;
  const step = spillStepFor(cards.length);
  const papers = [...root.querySelectorAll<HTMLElement>(".paper")];
  cards.forEach((card, index) => {
    const rest = toPx(card, view);
    add(papers[index], spillFrames(origin.x - rest.x, origin.y - rest.y, card.kick), { duration: spillMs, delay: spillFrom + index * step });
  });
  const spitting = cards.length ? (cards.length - 1) * step + spillMs * 0.6 : 0;
  const node = root.querySelector(".frodo-home");
  if (cards.length && node) {
    const body = node.querySelector(".vase-art");
    const head = node.querySelector(".duct-part-head");
    // 축(50% 90%)은 styles.css .vase-art에 둡니다. 키프레임에 transform-origin을 넣으면 WebKit이 합성 스레드로 넘기지 못해요.
    add(body, [{ transform: "none" }, { transform: "scale(1.05, 0.9)", offset: 0.7 }, { transform: "none" }], { duration: windUp, delay: windFrom, easing: "ease-in-out" });
    add(head, [{ transform: "none" }, { transform: "scale(0.9) rotate(5deg)", offset: 0.7 }, { transform: "none" }], { duration: windUp, delay: windFrom, easing: "ease-in-out" });
    add(head, [{ transform: "none" }, { transform: "scale(1.14) rotate(-6deg)", offset: 0.45 }, { transform: "none" }], { duration: puffMs, delay: spillFrom, iterations: Math.max(1, Math.round(spitting / puffMs)), easing: "ease-in-out" });
  }
  return { anims, endsAt: spillFrom + spitting + spillMs * 0.4, spitting, timers: [] };
}

// 처음 켤 때 한 번만. 방에서 돌아오면 다시 틀지 않습니다.
let entrancePlayed = false;

export function useHeroMotion(canvas: RefObject<HTMLElement | null>, cards: Card[], frodo: HeroFrodo | null, view: View, selectedId: string | null) {
  const engine = useEngine();
  // 등장. 휠, 키, 누르기 중 무엇이든 들어오면 바로 끝난 모습으로 갑니다.
  const hasScene = frodo !== null;
  useLayoutEffect(() => {
    if (entrancePlayed || !hasScene) return;
    if (reduced() || engine.pos !== 0 || selectedId) {
      entrancePlayed = true;
      return;
    }
    const root = canvas.current!;
    root.classList.add("entering");
    const { anims, endsAt, timers } = playEntrance(root, frodo!);
    const stop = () => {
      clearTimeout(timer);
      timers.forEach(clearTimeout);
      for (const name of inputs) removeEventListener(name, finish, true);
      for (const anim of anims) anim.cancel();
      root.classList.remove("entering");
    };
    const finish = () => {
      entrancePlayed = true;
      stop();
    };
    const inputs = ["wheel", "keydown", "pointerdown", "touchstart"] as const;
    for (const name of inputs) addEventListener(name, finish, { capture: true, passive: true });
    const timer = setTimeout(finish, endsAt);
    // StrictMode의 두 번째 실행에서 다시 틀 수 있게 여기서는 표시하지 않습니다.
    return stop;
  }, [hasScene]);

  // 방을 고를 때마다 그 방 주름관이 파일을 뱉습니다. 다른 방으로 바꾸거나 닫으면 남은 움직임은 멈춰요.
  useLayoutEffect(() => {
    if (!frodo || !selectedId || !frodo.segs.some((seg) => seg.room.id === selectedId) || reduced()) return;
    const { anims, spitting } = playSpill(canvas.current!, cards, frodo, view);
    // 웅크릴 때는 눈을 질끈 감고, 뱉는 동안은 눈을 크게 떠요. 끝나면 웃는 얼굴로 돌아가요. 뱉을 파일이 없는 방은 웅크리지 않아요.
    const id = homeActor;
    const timers = cards.length === 0 ? [] : [
      window.setTimeout(() => cue(id, { face: "shut", ms: windUp }), windFrom),
      window.setTimeout(() => cue(id, { face: "wide", ms: spitting }), spillFrom),
    ];
    return () => {
      timers.forEach(clearTimeout);
      anims.forEach((anim) => anim.cancel());
    };
  }, [selectedId]);
}
