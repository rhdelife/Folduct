import { useLayoutEffect, useRef, type RefObject } from "react";
import { toPx, type View } from "../../domain/sky";
import type { Card, HeroFrodo } from "../../domain/heroLayout";
import { cue, homeActor } from "../useFrodo";

// 첫 화면의 움직임: 방 카드를 고르면 그 방 용량만큼 몸이 받침에서 솟고, 입에서 그 방 파일이 제 칸으로 나옵니다.

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

// 방을 고르면 바로 그 방 용량만큼 받침에서 솟아요(growMs). 솟는 동안 형식 색도 받침에서 함께 차올라(fillMs) 한 번에 이어져 보여요.
const growMs = 640;
const fillMs = growMs + 160;
// 다 솟자마자 웅크렸다가 파일을 하나씩 뱉어요.
const windFrom = growMs + 40;
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

// 고르기: 늘어난 몸이 받침 아래에서 솟아올라요. 받침 선 아래는 가려 두니(styles.css .frodo-clip) 아직 안 솟은 몸은 보이지 않아요.
// 움직이는 건 translate·scale뿐이라 합성 스레드에서 돌아요. 고른 방 카드는 CSS(.room-node.fed)로 그림만 커져요.
function playFeed(root: HTMLElement, grownBy: number): Play {
  const anims: Animation[] = [];
  const add = player(anims);
  // 형식 색을 칠한 겹 그림의 칸을 받침에서 위로 걷어 올려요. 바깥 칸은 아래에서 올라오고 안쪽 그림은 그만큼 거꾸로 움직여 제자리에 있어요.
  // 둘 다 translate라 다시 그리지 않고 레이어만 움직여요.
  const fill = root.querySelector(".frodo-home .frodo-fill");
  const fillEase = "cubic-bezier(.33,0,.2,1)";
  add(fill, [{ translate: "0 100%", easing: fillEase }, { translate: "0 0" }], { duration: fillMs });
  add(fill?.firstElementChild, [{ translate: "0 -100%", easing: fillEase }, { translate: "0 0" }], { duration: fillMs });
  if (grownBy > 0) {
    // 한 번에 부드럽게 솟고 끝에서 살며시 멈춰요. 받침 선 아래는 .frodo-clip이 늘 가려요.
    add(root.querySelector(".frodo-lift"), [
      { translate: `0px ${grownBy}px`, easing: "cubic-bezier(.22,1,.36,1)" },
      { translate: "0px 0px" },
    ], { duration: growMs });
  }
  return { anims, endsAt: windFrom, timers: [] };
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
    // 몸은 숨쉬기로 이미 합성 레이어인 .vase-float에 scale로 겁니다. SVG(.vase-art)에 걸면 WebKit이 시작·끝에 레이어를 새로 만들며 프로도가 잠깐 사라졌어요.
    // 축(50% 90%)은 styles.css .vase-float에 둡니다. 키프레임에 transform-origin을 넣으면 WebKit이 합성 스레드로 넘기지 못해요.
    // 앱(WebKit)에서 확인한 것:
    // - SVG 안 머리(g)에 transform 움직임을 걸면 뱉는 동안 프로도 그림 전체가 사라지고 돌아오지 않았어요.
    // - 새 껍데기에 움직임을 걸면 시작·끝마다 레이어를 새로 만들어 프로도가 깜빡였어요.
    // 그래서 웅크리기와 꿀렁임은 숨쉬기로 늘 레이어인 .vase-float에 scale로만 걸고(숨쉬기는 transform이라 겹치지 않아요), 머리는 표정(눈)으로만 움직여요.
    const body = node.querySelector(".vase-float");
    add(body, [{ scale: "1" }, { scale: "1.05 0.9", offset: 0.7 }, { scale: "1" }], { duration: windUp, delay: windFrom, easing: "ease-in-out" });
    add(body, [{ scale: "1" }, { scale: "0.97 1.04", offset: 0.45 }, { scale: "1" }], { duration: puffMs, delay: spillFrom, iterations: Math.max(1, Math.round(spitting / puffMs)), easing: "ease-in-out" });
  }
  return { anims, endsAt: spillFrom + spitting + spillMs * 0.4, spitting, timers: [] };
}

export function useHeroMotion(canvas: RefObject<HTMLElement | null>, cards: Card[], frodo: HeroFrodo | null, view: View, selectedId: string | null) {
  // 먹기 전 몸 높이(그림 판 단위). 창 크기가 바뀌어도 그대로라, 먹은 뒤 늘어난 만큼만 지금 크기로 받침에서 솟게 해요.
  const lastBoard = useRef(frodo ? frodo.height / frodo.scale : 0);

  // 방을 먹일 때마다 삼키고, 늘어나고, 그 방 파일을 뱉어요. 다른 방을 먹이거나 비우면 남은 움직임은 멈춰요.
  useLayoutEffect(() => {
    const before = lastBoard.current;
    lastBoard.current = frodo ? frodo.height / frodo.scale : 0;
    if (!frodo || !selectedId || reduced()) return;
    const root = canvas.current!;
    const ate = playFeed(root, frodo.height - before * frodo.scale);
    const { anims, spitting } = playSpill(root, cards, frodo, view);
    // 웅크릴 때는 눈을 질끈 감고, 뱉는 동안은 눈을 크게 떠요. 끝나면 웃는 얼굴로 돌아가요. 뱉을 파일이 없는 방은 웅크리지 않아요.
    const id = homeActor;
    const timers = [...(cards.length === 0 ? [] : [
      window.setTimeout(() => cue(id, { face: "shut", ms: windUp }), windFrom),
      window.setTimeout(() => cue(id, { face: "wide", ms: spitting }), spillFrom),
    ])];
    return () => {
      timers.forEach(clearTimeout);
      [...ate.anims, ...anims].forEach((anim) => anim.cancel());
    };
  }, [selectedId]);
}
