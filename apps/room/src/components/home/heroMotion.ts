import { useLayoutEffect, useRef, type RefObject } from "react";
import { toPx, type View } from "../../domain/sky";
import type { Card, HeroFrodo } from "../../domain/heroLayout";
import { cue, homeActor } from "../useFrodo";

// 첫 화면의 움직임: 방 카드를 먹이면 카드가 프로도 입으로 날아들고, 삼킨 뒤 그 방 용량만큼 몸이 받침에서 솟고, 입에서 그 방 파일이 제 칸으로 나옵니다.

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

// 한 방을 먹는 시간: 카드가 입으로 날아들고(flyMs) 꿀꺽 삼킨 뒤(gulpMs) 그 방 용량만큼 받침에서 솟아요(growMs).
const flyMs = 420;
const gulpMs = 320;
const growMs = 420;
// 다 솟고 나서 웅크렸다가 파일을 하나씩 뱉어요. 솟기가 멈춘 바로 그 프레임을 피해 80ms 뒤에 시작해요.
const windFrom = flyMs + gulpMs + growMs + 80;
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

// 먹기: 먹을 방 카드를 본뜬 조각이 카드 자리(끌어다 놓았으면 놓은 자리)에서 입으로 날아들어 작아지며 사라져요.
// 삼키면 늘어난 몸이 받침 아래에서 솟아올라요. 받침 선 아래는 가려 두니(styles.css .growing .frodo-home) 아직 안 솟은 몸은 보이지 않아요.
// 움직이는 건 translate·scale·opacity뿐이라 합성 스레드에서 돌아요.
function playFeed(root: HTMLElement, frodo: HeroFrodo, roomId: string, from: { x: number; y: number } | null, grownBy: number): Play {
  const anims: Animation[] = [];
  const timers: number[] = [];
  const box = root.getBoundingClientRect();
  const card = root.querySelector<HTMLElement>(`.room-node[data-room-id="${CSS.escape(roomId)}"]`);
  if (card) {
    const rect = card.getBoundingClientRect();
    const morsel = card.cloneNode(true) as HTMLElement;
    morsel.className = "feed-morsel";
    morsel.removeAttribute("data-room-id");
    morsel.setAttribute("aria-hidden", "true");
    morsel.tabIndex = -1;
    const start = from ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    Object.assign(morsel.style, { left: `${start.x - box.left - rect.width / 2}px`, top: `${start.y - box.top - rect.height / 2}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    root.append(morsel);
    const dx = frodo.mouth.x - (start.x - box.left);
    const dy = frodo.mouth.y - (start.y - box.top);
    const fly = morsel.animate([
      { translate: "0px 0px", scale: "1", opacity: 1, easing: "cubic-bezier(.5,0,.75,0)" },
      { offset: 0.85, opacity: 1 },
      { translate: `${dx}px ${dy}px`, scale: "0.12", opacity: 0 },
    ], { duration: flyMs, fill: "forwards" });
    anims.push(fly);
    fly.finished.catch(() => undefined).finally(() => morsel.remove());
  }
  timers.push(window.setTimeout(() => cue(homeActor, { face: "wide", ms: flyMs }), 0));
  timers.push(window.setTimeout(() => cue(homeActor, { face: "shut", ms: gulpMs }), flyMs));
  if (grownBy > 0) {
    root.classList.add("growing");
    const grow = root.querySelector(".frodo-lift")?.animate([
      { translate: `0px ${grownBy}px` },
      { offset: (flyMs + gulpMs) / (flyMs + gulpMs + growMs), translate: `0px ${grownBy}px`, easing: "cubic-bezier(.3,1.4,.5,1)" },
      { translate: "0px 0px" },
    ], { duration: flyMs + gulpMs + growMs });
    if (grow) {
      anims.push(grow);
      // 끝까지 돈 때만 걷어요. 다른 방을 먹여 취소된 때는 새 먹기가 붙인 가림을 지우면 안 돼요(취소 정리는 effect가 해요).
      grow.finished.then(() => root.classList.remove("growing"), () => undefined);
    }
  }
  return { anims, endsAt: windFrom, timers };
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

export function useHeroMotion(canvas: RefObject<HTMLElement | null>, cards: Card[], frodo: HeroFrodo | null, view: View, selectedId: string | null, feedFrom: RefObject<{ x: number; y: number } | null>) {
  // 먹기 전 몸 높이(그림 판 단위). 창 크기가 바뀌어도 그대로라, 먹은 뒤 늘어난 만큼만 지금 크기로 받침에서 솟게 해요.
  const lastBoard = useRef(frodo ? frodo.height / frodo.scale : 0);

  // 방을 먹일 때마다 삼키고, 늘어나고, 그 방 파일을 뱉어요. 다른 방을 먹이거나 비우면 남은 움직임은 멈춰요.
  useLayoutEffect(() => {
    const before = lastBoard.current;
    lastBoard.current = frodo ? frodo.height / frodo.scale : 0;
    const from = feedFrom.current;
    feedFrom.current = null;
    if (!frodo || !selectedId || reduced()) return;
    const root = canvas.current!;
    const ate = playFeed(root, frodo, selectedId, from, frodo.height - before * frodo.scale);
    const { anims, spitting } = playSpill(root, cards, frodo, view);
    // 웅크릴 때는 눈을 질끈 감고, 뱉는 동안은 눈을 크게 떠요. 끝나면 웃는 얼굴로 돌아가요. 뱉을 파일이 없는 방은 웅크리지 않아요.
    const id = homeActor;
    const timers = [...ate.timers, ...(cards.length === 0 ? [] : [
      window.setTimeout(() => cue(id, { face: "shut", ms: windUp }), windFrom),
      window.setTimeout(() => cue(id, { face: "wide", ms: spitting }), spillFrom),
    ])];
    return () => {
      timers.forEach(clearTimeout);
      [...ate.anims, ...anims].forEach((anim) => anim.cancel());
      root.querySelectorAll(".feed-morsel").forEach((el) => el.remove());
      root.classList.remove("growing");
    };
  }, [selectedId]);
}
