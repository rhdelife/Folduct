import { objectScale } from "./care";
import type { Kind, Room, Thing } from "./model";
import { hash } from "./sky";

// 인트로의 시간표(ms). 종이가 다 날아드는 시간은 styles.css의 --intro-fly·--intro-stagger와 맞춰 둡니다.
export const introMs = { gather: 3300, fill: 2400, rise: 1300, leave: 600 };

// 파일을 먹는 순서: [스프라이트 프레임, ms]. 작은 입으로 종이를 오물오물 받아먹고, 냠냠 씹고, 꿀꺽 삼켜 제자리로 돌아옵니다. 다 더하면 introMs.gather예요.
const nibble: [number, number][] = [[5, 90], [6, 70], [7, 110], [8, 110], [9, 70], [10, 90]];
const chew: [number, number][] = [[11, 130], [12, 130], [11, 130], [12, 130]];
export const eatTimeline: [number, number][] = [
  [0, 80], [1, 160], [2, 80], [3, 120], [4, 200],
  ...nibble, ...nibble, ...nibble,
  ...chew,
  [13, 90], [14, 90], [15, 90], [16, 90],
  [0, 160],
];

// 스프라이트를 프레임 단위로 넘기는 키프레임. 사이를 잇지 않고 칸마다 뚝뚝 넘어갑니다.
export function eatKeyframes(timeline: [number, number][], frameCount: number): Keyframe[] {
  const total = timeline.reduce((sum, [, ms]) => sum + ms, 0);
  let at = 0;
  const frames = timeline.map(([frame, ms]): Keyframe => {
    const key = { offset: at / total, easing: "step-end", transform: `translateX(${(-frame / frameCount) * 100}%)` };
    at += ms;
    return key;
  });
  return [...frames, { offset: 1, transform: frames[frames.length - 1].transform }];
}

export const introPaperCount = 14;
const introMinThings = 6;
const introPaperBase = 60;

export type IntroPaper = { id: string; kind: Kind; name: string; size: number; x: number; y: number; rot: number };

// 파일이 너무 적으면 빈 화면 같으니 샘플 방의 파일로 보여 줍니다. 저장은 하지 않아요.
export function introThings(rooms: Room[], samples: Room[]): Thing[] {
  const real = rooms.flatMap((room) => room.things).filter((thing) => !thing.missing);
  return real.length >= introMinThings ? real : samples.flatMap((room) => room.things);
}

// 형식이 고루 보이도록 형식마다 한 장씩 돌아가며 고릅니다.
function pickPapers(things: Thing[]): Thing[] {
  const byKind = new Map<Kind, Thing[]>();
  for (const thing of things) byKind.set(thing.kind, [...(byKind.get(thing.kind) ?? []), thing]);
  const piles = [...byKind.values()];
  const picked: Thing[] = [];
  for (let turn = 0; picked.length < Math.min(introPaperCount, things.length); turn += 1) {
    for (const pile of piles) if (pile[turn] && picked.length < introPaperCount) picked.push(pile[turn]);
  }
  return picked;
}

// 화면 가운데(주름관과 글자 자리)를 비우고 네모난 고리 위에 고르게 흩어 놓습니다. x는 vw, y는 vh, 가운데가 0입니다.
export function introPapers(things: Thing[]): IntroPaper[] {
  const picked = pickPapers(things);
  return picked.map((thing, index) => {
    const angle = ((index + hash(thing.id, 1) * 0.5) / picked.length) * 2 * Math.PI - Math.PI / 2;
    const reach = Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)));
    return {
      id: thing.id,
      kind: thing.kind,
      name: thing.name,
      size: Math.round(introPaperBase * objectScale(thing.size)),
      x: ((38 + hash(thing.id, 2) * 7) * Math.cos(angle)) / reach,
      y: ((35 + hash(thing.id, 3) * 7) * Math.sin(angle)) / reach,
      rot: (hash(thing.id, 4) - 0.5) * 40,
    };
  });
}
