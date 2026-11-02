import { lastActivity, sizeRatio, withinWeek, type Stage } from "./care";
import type { Room, Thing } from "./model";
import { hash, labelHalf, labelHeight, labelsHideFrom, layoutRooms, relaxBoxes, roomRadius, settleBoxes, roomStars, stageUnit, toPx, toSky, vaseHalf, vaseLift, vaseUnit, type Box, type Movable, type Placed, type Star, type View } from "./sky";

// 첫 화면 배치: 방 둘레의 파일을 판 전체에 흩고, 머리글·화병·이름표·머리 버튼을 피해 겹치지 않게 다듬습니다.

// shortcut: 판에는 약 24장만 띄웁니다(방마다 번갈아 큰 파일부터). 고른 방만 제 파일을 한도까지 더 보여요. 방이 이보다 많으면 방마다 한 장씩은 띄워요. 판을 더 채우고 싶으면 이 값을 올려요.
export const cardCap = 24;
const fillLimit = 0.42;
// 이름이 찍히는 가장 작은 종이 폭(글자는 8.5px 아래로 줄지 않아요). 작은 창에서는 종이 눈금이 이 밑으로 내려가지 않게 세우고, 판을 조금 더 채웁니다.
export const namedPaper = 46;
const smallUnit = namedPaper / 56;
const smallFill = 0.55;

export type Card = Star & {
  room: Room;
  // 종이 폭과 높이(px)
  size: number;
  height: number;
  rot: number;
  kick: number;
  // 판에 늘 뜨는 장이 아니라 방을 골라야 나오는 장.
  extra: boolean;
  // 공책의 어느 칸으로 날아가는지: 0 먼저, 1 참고, 2 나중에.
  section: 0 | 1 | 2;
};
export type HeroNode = Placed & { r: number };
export type HeroLayout = { nodes: HeroNode[]; cards: Card[] };

// 파일이 클수록 큰 종이. 로그 눈금이라 1KB 56, 1MB 76, 1GB 96(1280 기준)입니다. 가장 작아도 이름이 찍혀요(ObjectShape).
export const paperWidth = (bytes: number, unit: number) => (56 + 40 * sizeRatio(bytes)) * unit;

// 멀쩡한 파일은 살짝, 기운 파일은 더, 쓰러진 파일은 크게 기웁니다. 이름은 고개를 꺾지 않고 읽혀야 해서 눕히지는 않아요.
export function restAngle(stage: Stage, id: string): number {
  const side = hash(id, 21) < 0.5 ? -1 : 1;
  const amount = hash(id, 22);
  if (stage === "fallen") return side * (30 + 14 * amount);
  if (stage === "tilted") return side * (13 + 11 * amount);
  return side * 7 * amount;
}

function sectionOf(thing: Thing, stage: Stage, now: number): Card["section"] {
  if (stage === "fallen") return 0;
  if (stage === "tilted") return 1;
  return withinWeek(lastActivity(thing), now) ? 1 : 2;
}

// 돌아간 사각형을 감싸는 상자의 반쪽 크기.
function reach(w: number, h: number, degrees: number) {
  const angle = (degrees * Math.PI) / 180;
  return { hw: (Math.abs(Math.cos(angle)) * w + Math.abs(Math.sin(angle)) * h) / 2, hh: (Math.abs(Math.sin(angle)) * w + Math.abs(Math.cos(angle)) * h) / 2 };
}

// 파일이 피할 자리: 머리의 로고·숫자·버튼, 화병과 이름표.
export function keepOut(nodes: HeroNode[], view: View): Box[] {
  const unit = stageUnit(view);
  const crowded = nodes.length >= labelsHideFrom;
  const margin = 10 * unit;
  const boxes: Box[] = [
    view.w < 720 ? { x: 90, y: 40, hw: 90, hh: 52 } : { x: 160, y: 40, hw: 160, hh: 34 },
    // 메뉴에 '정리할 때예요'가 붙어도 종이가 밑에 깔리지 않을 폭입니다. 알림이 떠도 종이가 움직이지 않게 늘 비워요.
    view.w < 720 ? { x: view.w - 90, y: 40, hw: 90, hh: 52 } : { x: view.w - 130, y: 40, hw: 130, hh: 34 },
  ];
  for (const { at, r, room } of nodes) {
    const center = toPx(at, view);
    // 고르면 화병이 커지니 커진 크기로 비워 둡니다. 많을 때는 그럴 자리가 없어요.
    const half = vaseHalf(r) * unit * vaseUnit * (crowded ? 1.1 : vaseLift);
    boxes.push({ x: center.x, y: center.y, hw: half + margin, hh: half + margin });
    if (crowded) continue;
    // 이름표는 화병 아래이고, 화병이 커지면 함께 내려갑니다. 두 자리를 다 비워요.
    const plain = vaseHalf(r) * unit * vaseUnit;
    const top = center.y + plain * 1.2;
    const bottom = center.y + plain * (0.24 + vaseLift) + labelHeight * 0.75;
    boxes.push({ x: center.x, y: (top + bottom) / 2, hw: labelHalf(room.name, view) + margin, hh: (bottom - top) / 2 + margin });
  }
  return boxes;
}

export function heroLayout(rooms: Room[], now: number, view: View, aspect: (thing: Thing) => number, selectedId: string | null = null): HeroLayout {
  const unit = stageUnit(view);
  const nodes: HeroNode[] = layoutRooms(rooms, view).map((placed) => ({ ...placed, r: roomRadius(placed.room, placed.scale) }));

  // 방마다 번갈아 한 장씩 뽑아 작은 방도 빠지지 않게 합니다.
  const piles = nodes.map(({ room, at, spread, scale }) => ({ room, stars: roomStars(room, at, spread, now, 40, scale) }));
  const limits = nodes.map((node) => node.limit);
  const base: { room: Room; star: Star }[] = [];
  const cap = Math.max(cardCap, nodes.length);
  for (let turn = 0; base.length < cap && piles.some(({ stars }, i) => turn < Math.min(stars.length, limits[i])); turn += 1) {
    piles.forEach(({ room, stars }, i) => {
      if (base.length < cap && turn < Math.min(stars.length, limits[i])) base.push({ room, star: stars[turn] });
    });
  }
  const shown = new Set(base.map(({ star }) => star.thing.id));
  const extras = piles.filter(({ room }) => room.id === selectedId).flatMap(({ room, stars }) => stars.filter(({ thing }) => !shown.has(thing.id)).map((star) => ({ room, star })));

  const fixed = keepOut(nodes, view);
  const free = view.w * view.h - fixed.reduce((sum, box) => sum + 4 * box.hw * box.hh, 0);
  const paperUnit = Math.max(unit, smallUnit);
  const widths = base.map(({ star }) => paperWidth(star.thing.size, paperUnit));
  const area = base.reduce((sum, { star }, i) => sum + widths[i] * widths[i] * aspect(star.thing) * 1.1, 0);
  // 판이 작거나 방이 많으면 비율은 그대로 두고 다 같이 줄입니다.
  let fit = area > 0 ? Math.min(1, Math.sqrt(((unit < smallUnit ? smallFill : fillLimit) * Math.max(free, view.w * view.h * 0.2)) / area)) : 1;

  // 다 같이 줄여도 이름이 찍히는 크기 밑으로는 웬만하면 내려가지 않습니다.
  let floor = namedPaper;

  const cardOf = ({ room, star }: { room: Room; star: Star }, extra: boolean): { card: Card; item: Movable } => {
    const id = star.thing.id;
    const natural = paperWidth(star.thing.size, paperUnit);
    // 키가 큰 종이도 124 안에서 멈춥니다. 안 그러면 한 장이 판을 차지해요.
    const size = Math.round(Math.min(Math.max(natural * fit, Math.min(natural, floor)), (124 * paperUnit) / aspect(star.thing)));
    const height = size >= 40 ? size * aspect(star.thing) : size;
    const rot = restAngle(star.stage, id);
    const { hw, hh } = reach(size, height, rot);
    const seed = toPx(star, view);
    // 판이 차면 몇 장은 밖으로 조금 걸칩니다. 몇 장 없는 방은 다 안에 들어와 이름이 잘리지 않아요.
    const edge = base.length >= 18 && hash(id, 23) < 0.32 ? 0.45 : 1.02;
    const card: Card = {
      ...star,
      room,
      size,
      height,
      rot,
      kick: (hash(id, 24) < 0.5 ? -1 : 1) * (6 + 8 * hash(id, 25)),
      extra,
      section: sectionOf(star.thing, star.stage, now),
    };
    return { card, item: { x: seed.x, y: seed.y, hw, hh, minX: hw * edge, maxX: view.w - hw * edge, minY: hh * edge, maxY: view.h - hh * edge } };
  };

  // 자리를 못 찾은 장이 있으면 다 같이 조금 더 줄여 다시 놓습니다.
  let placed: ReturnType<typeof cardOf>[] = [];
  let stuck = new Set<Movable>();
  for (let tries = 0; tries < 4; tries += 1) {
    // 마지막 시도는 바닥 없이 줄여 종이를 빼지 않는 쪽을 택합니다.
    if (tries === 3) floor = 0;
    placed = base.map((entry) => cardOf(entry, false));
    const items = placed.map(({ item }) => item);
    const used = items.reduce((sum, { hw, hh }) => sum + 4 * hw * hh, 0);
    // 부풀린 상자들이 빈자리를 넘치게 채우면 서로 밀려 판 전체에 고르게 퍼집니다.
    const side = items.length ? Math.sqrt(used / items.length) : 0;
    const pad = items.length ? Math.max(0, (Math.sqrt((Math.max(free, 1) * 1.05) / items.length) - side) / 2) : 0;
    relaxBoxes(items, fixed, { pad, gap: 6 * unit, passes: 120 });
    stuck = settleBoxes(items, fixed, 2 * unit, 14 * unit);
    if (stuck.size === 0) break;
    fit *= 0.88;
  }
  // shortcut: 그래도 자리가 없으면 그 장은 띄우지 않습니다(전부는 패널 목록에 있어요). 720x520에 방이 아주 많을 때뿐이라 더 손대지 않았어요.

  const more = extras.map((entry) => cardOf(entry, true));
  if (more.length) {
    // 더 나온 장은 다른 방의 흐려진 종이와는 겹쳐도 되고, 고른 방의 종이는 피합니다.
    const own = placed.filter(({ card }) => card.room.id === selectedId).map(({ item }) => item);
    const moved = more.map(({ item }) => item);
    relaxBoxes(moved, [...fixed, ...own], { gap: 4 * unit, passes: 60 });
    settleBoxes(moved, [...fixed, ...own], 2 * unit, 14 * unit);
  }

  const cards = [...placed.filter(({ item }) => !stuck.has(item)), ...more].map(({ card, item }) => ({ ...card, ...toSky(item, view) }));
  return { nodes, cards };
}

// ── 첫 스크롤: 띠와 공책 더미 ──

export type Flight = { rest: Pt; belt: Pt & { rot: number; scale: number }; land: Pt & { rot: number; scale: number }; slot: number; section: Card["section"] };
type Pt = { x: number; y: number };

// 띠의 지그재그 각도. 줄에 꿴 듯 보이는 값입니다.
const beltTilt = [-6, 3, -8, 5, -2, 7, -4, 10, 4, -7, 9, -3, 6, -10, 2, -5, -9, 5, -3, 8, -6, 11];

// 공책의 자리. anchors는 칸 글자의 왼쪽 끝과 그 아래 내용이 시작하는 높이입니다. 공책 장면을 잴 수 있으면 잰 값을 씁니다(SkyMap).
export type Anchor = { x: number; y: number };
export type NotebookGuide = { anchors: Anchor[]; beltY: number; sheetW: number };

// 공책을 아직 잴 수 없을 때의 기본값입니다. 칸 높이는 1280x840에서 잰 비율이에요.
export function notebookGuide({ w, h }: View): NotebookGuide {
  const [sheetW, ratio, padTop] = w > 1024 ? [w * 0.55, 780 / 800, h * 0.03] : w >= 600 ? [w * 0.82, 950 / 800, h * 0.09] : [Math.min(w * 0.92, h * 0.49), 1100 / 800, h * 0.12];
  const beltRow = Math.min(90, Math.max(36, w * 0.07));
  const top = padTop + beltRow + h * 0.02;
  const left = (w - sheetW) / 2;
  return { sheetW, beltY: padTop + beltRow / 2, anchors: [0.1368, 0.6056, 0.7377].map((at) => ({ x: left + sheetW * 0.08, y: top + sheetW * ratio * at })) };
}

// 쉬던 자리의 x 순서대로 띠에 앉히니 길이 서로 엇갈리지 않습니다. 공책으로 갈 때도 왼쪽부터 차례로 떨어져요.
export function flightsFor(cards: Card[], view: View, { anchors, beltY, sheetW }: NotebookGuide = notebookGuide(view)): Map<string, Flight> {
  const vw = view.w / 100;
  // 띠에서는 폭을 4vw로 맞춥니다. 높이가 달라 줄에 꿴 종이처럼 보여요.
  const beltW = 51.2 * stageUnit(view);
  const k = sheetW / 704;
  const order = cards.map((card) => ({ card, rest: toPx(card, view) })).sort((a, b) => a.rest.x - b.rest.x);
  const count = order.length;
  const step = count > 1 ? Math.min(3.3 * vw, (69.3 * vw) / (count - 1)) : 0;
  const left = view.w / 2 - (step * (count - 1)) / 2;
  const seen = [0, 0, 0];
  const totals = [0, 1, 2].map((s) => order.filter(({ card }) => card.section === s).length);
  const flights = new Map<string, Flight>();
  order.forEach(({ card, rest }, slot) => {
    const section = card.section;
    const index = seen[section]++;
    const span = 250 * k;
    const gap = totals[section] > 1 ? Math.min(62.5 * k, span / (totals[section] - 1)) : 0;
    const landW = beltW * 0.6;
    flights.set(card.thing.id, {
      rest,
      slot,
      section,
      belt: { x: left + slot * step, y: beltY, rot: beltTilt[slot % beltTilt.length], scale: beltW / card.size },
      land: {
        x: anchors[section].x + landW / 2 + index * gap,
        y: anchors[section].y + (18.5 + (hash(card.thing.id, 28) - 0.5) * 20) * k,
        // 칸마다 달라 보이는 각도(참고 사이트에서 잰 수열 그대로).
        rot: ((7.01 * slot) % 20) - 10,
        scale: landW / card.size,
      },
    });
  });
  return flights;
}

