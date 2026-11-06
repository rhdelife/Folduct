import { lastActivity, sizeRatio } from "./care";
import type { Room, Thing } from "./model";
import { calendarSpot, hash, homeLimit, labelHeight, roomRadius, roomStars, stageUnit, toSky, vaseHalf, vaseUnit, type Placed, type Star, type View } from "./sky";

// 첫 화면 배치: 주름관이 받침 높이를 맞춰 한 줄로 서고, 파일은 각자의 주름관 아래 칸에 최근 작업 순서로 가지런히 놓입니다.
// 칸이 차면 남은 수만 "+N개 더"로 알려요. 폭이 모자라면 줄을 하나 더 만들어 아래로 놓습니다(옆으로 밀지 않아요).

// 이름이 찍히는 가장 작은 종이 폭(글자는 8.5px 아래로 줄지 않아요).
export const namedPaper = 46;
const smallUnit = namedPaper / 56;
// 칸 폭. 프로젝트가 적어도 칸은 이보다 넓어지지 않고, 이보다 좁아지면 다음 줄로 내려요.
export const columnMin = 170;
const columnMax = 300;
const edge = 16;
const columnPad = 18;
// "+N개 더" 한 줄의 높이(styles.css .room-more)
export const moreHeight = 32;
const moreWidth = 96;

export type Card = Star & {
  room: Room;
  // 종이 폭과 높이(px)
  size: number;
  height: number;
  rot: number;
  kick: number;
};
export type HeroNode = Placed & { r: number };
// 칸에 다 못 놓은 파일 수와 그 글자를 놓을 자리(지도 좌표).
export type MoreSpot = { room: Room; x: number; y: number; count: number };
export type HeroLayout = { nodes: HeroNode[]; cards: Card[]; more: MoreSpot[] };

// 파일이 클수록 큰 종이. 로그 눈금이라 1KB 56, 1MB 76, 1GB 96(1280 기준)입니다. 가장 작아도 이름이 찍혀요(ObjectShape).
export const paperWidth = (bytes: number, unit: number) => (56 + 40 * sizeRatio(bytes)) * unit;

const headerBottom = (view: View) => (view.w < 720 ? 112 : view.w < 1200 ? 100 : 74);
// 현관 줄의 높이. styles.css의 .doorstep 한 줄에 맞춰요.
const doorHeight = 118;
const doorBottom = (view: View) => headerBottom(view) + doorHeight;

export function heroLayout(rooms: Room[], now: number, view: View, aspect: (thing: Thing) => number, doorOpen = false): HeroLayout {
  const active = rooms.filter((room) => !room.care.done).slice(0, homeLimit);
  if (active.length === 0) return { nodes: [], cards: [], more: [] };
  const unit = stageUnit(view);
  const ductUnit = unit * vaseUnit;
  const paperUnit = Math.max(unit, smallUnit);
  const gap = Math.max(6, 10 * unit);
  const label = Math.max(labelHeight * unit, 48);
  const top = (doorOpen ? doorBottom(view) : headerBottom(view)) + edge;

  const across = view.w - 2 * edge;
  const perLine = Math.max(1, Math.min(active.length, Math.floor(across / columnMin)));
  const lines = Math.ceil(active.length / perLine);
  const width = Math.min(columnMax, across / perLine);
  const band = (view.h - top - edge) / lines;
  const radii = active.map((room) => roomRadius(room));
  const tallest = Math.max(...radii.map((r) => vaseHalf(r) * ductUnit));
  const [calendar] = calendarSpot(view);

  const nodes: HeroNode[] = [];
  const cards: Card[] = [];
  const more: MoreSpot[] = [];
  active.forEach((room, i) => {
    const line = Math.floor(i / perLine);
    const inLine = Math.min(perLine, active.length - line * perLine);
    const x = (view.w - width * inLine) / 2 + width * (i % perLine + 0.5);
    const lineTop = top + band * line;
    // 받침 높이를 맞춥니다. 작은 주름관은 같은 바닥에 서서 키만 낮아요.
    const feet = lineTop + tallest * 2;
    const r = radii[i];
    const at = { x, y: feet - vaseHalf(r) * ductUnit };
    nodes.push({ room, at: toSky(at, view), scale: 1, spread: 0, limit: 0, r });

    const bottom = lineTop + band - edge;
    const span = { left: x - width / 2 + columnPad, right: x + width / 2 - columnPad };
    // 왼쪽 아래 일력 높이에 닿는 줄은 일력 오른쪽으로 비켜 놓습니다.
    const calendarTop = calendar ? calendar.y - calendar.hh - edge : Infinity;
    const calendarRight = calendar ? calendar.x + calendar.hw + gap : -Infinity;
    const leftAt = (y: number, height: number) => (y + height > calendarTop ? Math.max(span.left, calendarRight) : span.left);
    // "+N개 더"가 그 높이에 들어갈 자리가 있는지. 일력 옆이 좁으면 그 위로 올려야 해요.
    const moreFits = (y: number) => y + moreHeight <= bottom && span.right - leftAt(y, moreHeight) >= moreWidth;
    const stars = roomStars(room, at, 0, now, room.things.length).sort((a, b) => lastActivity(b.thing) - lastActivity(a.thing) || b.thing.size - a.thing.size);
    // 칸이 낮은 폰에서는 한 줄과 "+N개 더"가 들어가도록 종이를 줄입니다.
    // 반올림으로 1px 넘치지 않게 조금 덜어 둡니다.
    const tallestPaper = Math.max(24, bottom - (feet + label) - gap - moreHeight - 1);
    const sized = stars.map((star) => {
      let size = Math.min(paperWidth(star.thing.size, paperUnit), span.right - span.left);
      const ratio = size >= 40 ? aspect(star.thing) : 1;
      size = Math.floor(size * ratio > tallestPaper ? tallestPaper / ratio : size);
      return { star, size, height: size >= 40 ? Math.round(size * aspect(star.thing)) : size };
    });

    // 왼쪽부터 채우고, 폭을 넘으면 다음 줄로 내려요. 줄 안에서는 바닥을 맞춥니다.
    const build = (from: number, space: number) => {
      const row = { items: [] as typeof sized, width: 0, height: 0 };
      for (const item of sized.slice(from)) {
        const next = row.items.length ? row.width + gap + item.size : item.size;
        if (next > space) break;
        row.items.push(item);
        row.width = next;
        row.height = Math.max(row.height, item.height);
      }
      return row;
    };
    let y = feet + label;
    let shown = 0;
    while (shown < sized.length) {
      let left = span.left;
      let row = build(shown, span.right - left);
      if (leftAt(y, row.height) > left) {
        left = leftAt(y, row.height);
        row = build(shown, span.right - left);
      }
      const leftAfter = sized.length - shown - row.items.length;
      // 뒤에 남는 파일이 있으면 "+N개 더" 자리까지 남겨야 합니다.
      if (row.items.length === 0 || y + row.height > bottom || (leftAfter > 0 && !moreFits(y + row.height + gap))) break;
      let cursor = (left + span.right) / 2 - row.width / 2;
      for (const { star, size, height } of row.items) {
        const id = star.thing.id;
        const center = { x: cursor + size / 2, y: y + row.height - height / 2 };
        cards.push({ ...star, ...toSky(center, view), room, size, height, rot: 0, kick: (hash(id, 24) < 0.5 ? -1 : 1) * (6 + 8 * hash(id, 25)) });
        cursor += size + gap;
      }
      shown += row.items.length;
      y += row.height + gap;
    }
    if (shown < sized.length) more.push({ room, ...toSky({ x: (leftAt(y, moreHeight) + span.right) / 2, y: y + moreHeight / 2 }, view), count: sized.length - shown });
  });
  return { nodes, cards, more };
}
