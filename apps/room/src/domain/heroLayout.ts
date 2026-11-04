import { lastActivity, sizeRatio } from "./care";
import type { Room, Thing } from "./model";
import { calendarSpot, hash, labelHalf, labelHeight, layoutRooms, relaxBoxes, roomRadius, settleBoxes, roomStars, stageUnit, toPx, toSky, vaseHalf, vaseLift, vaseUnit, type Box, type Movable, type Placed, type Star, type View } from "./sky";

// 첫 화면 배치: 방 둘레의 파일을 판 전체에 흩고, 머리글·주름관·이름표·머리 버튼을 피해 겹치지 않게 다듬습니다.

// shortcut: 판에는 약 24장만 띄웁니다(방마다 번갈아 큰 파일부터). 고른 방만 제 파일을 한도까지 더 보여요. 방이 이보다 많으면 방마다 한 장씩은 띄워요. 판을 더 채우고 싶으면 이 값을 올려요.
export const cardCap = 24;
const fillLimit = 0.42;
// 이름이 찍히는 가장 작은 종이 폭(글자는 8.5px 아래로 줄지 않아요). 작은 창에서는 종이 눈금이 이 밑으로 내려가지 않게 세우고, 판을 조금 더 채웁니다.
export const namedPaper = 46;
const smallUnit = namedPaper / 56;
const smallFill = 0.55;

export type Card = Star & {
  room: Room;
  rowOnly?: boolean;
  // 종이 폭과 높이(px)
  size: number;
  height: number;
  rot: number;
  kick: number;
  // 판에 늘 뜨는 장이 아니라 방을 골라야 나오는 장.
  extra: boolean;
};
export type HeroNode = Placed & { r: number };
export type HeroLayout = { nodes: HeroNode[]; cards: Card[] };

// 파일이 클수록 큰 종이. 로그 눈금이라 1KB 56, 1MB 76, 1GB 96(1280 기준)입니다. 가장 작아도 이름이 찍혀요(ObjectShape).
export const paperWidth = (bytes: number, unit: number) => (56 + 40 * sizeRatio(bytes)) * unit;

// 파일마다 살짝 다르게 놓입니다. 상태와는 상관없어요.
export function restAngle(id: string): number {
  return (hash(id, 21) < 0.5 ? -1 : 1) * 7 * hash(id, 22);
}

// 돌아간 사각형을 감싸는 상자의 반쪽 크기.
function reach(w: number, h: number, degrees: number) {
  const angle = (degrees * Math.PI) / 180;
  return { hw: (Math.abs(Math.cos(angle)) * w + Math.abs(Math.sin(angle)) * h) / 2, hh: (Math.abs(Math.sin(angle)) * w + Math.abs(Math.cos(angle)) * h) / 2 };
}

const headerBottom = (view: View) => (view.w < 720 ? 112 : view.w < 1200 ? 100 : 74);

// 파일이 피할 자리: 머리의 로고·숫자·버튼, 주름관과 이름표.
// 좁은 창은 머리 띠 전체를 비웁니다. 높이는 styles.css의 --topbar-stacked-h, --topbar-phone-h예요.
export function keepOut(nodes: HeroNode[], view: View): Box[] {
  const unit = stageUnit(view);
  const margin = 10 * unit;
  const band = (height: number): Box => ({ x: view.w / 2, y: height / 2, hw: view.w / 2, hh: height / 2 });
  const boxes: Box[] = view.w < 1200 ? [band(headerBottom(view))] : [
    { x: 160, y: 40, hw: 160, hh: 34 },
    { x: view.w / 2, y: 40, hw: 160, hh: 34 },
    // 메뉴에 '정리할 때예요'가 붙어도 종이가 밑에 깔리지 않을 폭입니다. 알림이 떠도 종이가 움직이지 않게 늘 비워요.
    { x: view.w - 130, y: 40, hw: 130, hh: 34 },
  ];
  boxes.push(...calendarSpot(view));
  for (const { at, r, room } of nodes) {
    const center = toPx(at, view);
    // 고르면 주름관이 커지니 커진 크기로 비워 둡니다.
    const half = vaseHalf(r) * unit * vaseUnit * vaseLift;
    boxes.push({ x: center.x, y: center.y, hw: half + margin, hh: half + margin });
    // 이름표는 주름관 아래이고, 주름관이 커지면 함께 내려갑니다. 두 자리를 다 비워요.
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
    const rot = restAngle(id);
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

// ── 첫 스크롤: 한 줄로 모으기 ──

type Pt = { x: number; y: number };
// to.rot은 쉬는 기울기에 더하는 값이고, stagger는 출발하는 차례(0~1), slot은 줄에서 왼쪽부터의 차례입니다.
// half와 tall은 줄에서의 반쪽 폭과 높이, rowOnly는 지도에 없고 줄에만 있는 종이입니다.
export type Flight = { rest: Pt; to: Pt & { rot: number; scale: number }; stagger: number; slot: number; half: number; tall: number; rowOnly: boolean };

// 줄은 더미처럼 놓입니다. 이웃과 평균 폭의 이만큼 겹치고, 종이마다 이 각도 안에서 조금씩 기울어요.
const rowOverlap = 0.24;
export const rowTilt = 4;
const rowEdge = 16;
// 이보다 작아지면 무엇인지 안 보입니다. 넘치는 만큼은 옆으로 밀어서 봐요.
const rowMinScale = 0.8;
// shortcut: 줄에는 최근 파일 120장까지만 그립니다. 다 그리면 첫 스크롤이 끊겨요. 더 필요해지면 보이는 장만 그리도록 바꿉니다.
export const rowCap = 120;
const rowTries = 12;

// 줄의 높이 자리: 머리와 현관 줄(top) 아래에서 주름관과 이름표에 가장 덜 걸리는 곳. 비슷하면 가운데 쪽입니다.
function rowY(height: number, nodes: HeroNode[], view: View, top: number): number {
  const min = Math.max(top, headerBottom(view)) + height / 2 + rowEdge;
  // 아래에 옆으로 미는 막대 자리를 남깁니다.
  const max = Math.max(min, view.h - height / 2 - rowEdge * 2);
  const boxes = keepOut(nodes, view);
  const cost = (y: number) => Math.abs(y - (min + max) / 2) + boxes.reduce((sum, box) => sum + Math.max(0, Math.min(y + height / 2, box.y + box.hh) - Math.max(y - height / 2, box.y - box.hh)) * box.hw, 0);
  const tries = Array.from({ length: rowTries + 1 }, (_, i) => min + ((max - min) * i) / rowTries);
  return tries.reduce((best, y) => (cost(y) < cost(best) ? y : best));
}

// 지도에 못 나온 파일도 줄에는 놓습니다. 지도 종이와 비슷한 크기로, 최근 파일부터 rowCap까지요. 자리는 flightsFor가 정해요.
export function rowOnlyCards(cards: Card[], nodes: HeroNode[], now: number, view: View, aspect: (thing: Thing) => number): Card[] {
  const unit = Math.max(stageUnit(view), smallUnit);
  const onMap = new Set(cards.map((card) => card.thing.id));
  const fit = cards.length ? cards.reduce((sum, card) => sum + card.size / paperWidth(card.thing.size, unit), 0) / cards.length : 1;
  return nodes
    .flatMap(({ room, at, spread, scale }) => roomStars(room, at, spread, now, rowCap, scale).filter((star) => !onMap.has(star.thing.id)).map((star) => ({ room, star })))
    .sort((a, b) => lastActivity(b.star.thing) - lastActivity(a.star.thing))
    .slice(0, Math.max(0, rowCap - cards.length))
    .map(({ room, star }) => {
      const size = Math.round(paperWidth(star.thing.size, unit) * fit);
      return { ...star, x: 0, y: 0, room, size, height: size >= 40 ? size * aspect(star.thing) : size, rot: 0, kick: 0, extra: false, rowOnly: true };
    });
}

// 줄이 창보다 얼마나 긴지와 줄의 아래 끝.
export function rowMetrics(flights: ReadonlyMap<string, Flight>, view: View): { overflow: number; bottom: number } {
  const all = [...flights.values()];
  return { overflow: Math.max(0, Math.max(0, ...all.map((flight) => flight.to.x + flight.half)) + rowEdge - view.w), bottom: Math.max(0, ...all.map((flight) => flight.to.y + flight.tall)) };
}

// 종이를 최근에 작업한 순서로 왼쪽부터 살짝 겹쳐 한 줄로 모읍니다. 크기 비율은 그대로이고, 창에 안 들어가면 조금 줄인 뒤 옆으로 넘어가요.
export function flightsFor(cards: Card[], nodes: HeroNode[], view: View, top = 0): Map<string, Flight> {
  const order = [...cards].sort((a, b) => lastActivity(b.thing) - lastActivity(a.thing) || a.x - b.x);
  const room = view.w - 2 * rowEdge;
  const gaps = Math.max(0, order.length - 1);
  const widths = order.reduce((sum, card) => sum + card.size, 0);
  const lap = (widths / Math.max(1, order.length)) * rowOverlap;
  const scale = Math.max(rowMinScale, Math.min(1, room / Math.max(1, widths - lap * gaps)));
  const gap = -lap * scale;
  const y = rowY(Math.max(0, ...order.map((card) => card.height)) * scale, nodes, view, top);
  const flights = new Map<string, Flight>();
  const total = widths * scale + gap * gaps;
  let x = total > room ? rowEdge : (view.w - total) / 2;
  order.forEach((card, slot) => {
    const size = card.size * scale;
    flights.set(card.thing.id, { rest: toPx(card, view), stagger: hash(card.thing.id, 31), slot, half: size / 2, tall: (card.height * scale) / 2, rowOnly: card.rowOnly === true, to: { x: x + size / 2, y, rot: (hash(card.thing.id, 37) * 2 - 1) * rowTilt - card.rot, scale } });
    x += size + gap;
  });
  return flights;
}
