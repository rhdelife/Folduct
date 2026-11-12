import { ductLength, stackGeometry } from "../art/duct";
import { lastActivity, roomUsage, sizeRatio } from "./care";
import type { Room, Thing } from "./model";
import { calendarSpot, hash, homeLimit, roomStars, stageUnit, toSky, type Point, type Star, type View } from "./sky";

// 첫 화면 배치: 위에 방(프로젝트) 카드 한 줄, 그 아래 받침 위에 선 프로도 한 명.
// 방 카드를 프로도에게 먹이면 그 방 용량만큼 몸이 늘어나고, 그 방 파일이 넓은 창에서는 프로도 오른쪽, 좁은 창에서는 프로도 아래 칸에
// 최근 작업 순서로 놓이며 칸 아래에 "방 열기"가 붙어요. 아무것도 안 먹은 프로도는 목만 내민 짧은 몸이에요.

// 이름이 찍히는 가장 작은 종이 폭(글자는 8.5px 아래로 줄지 않아요).
export const namedPaper = 46;
const smallUnit = namedPaper / 56;
const edge = 16;
// "방 열기 · +N개 더" 한 줄의 높이(styles.css .room-more)
export const moreHeight = 32;
const moreWidth = 96;
// 위 방 카드 줄의 높이. styles.css .room-shelf(--shelf-cover)와 맞춰요.
export const shelfHeight = (view: View) => (view.w < 720 ? 92 : 124);
// 화면 아래 가운데 "형식별로 보기" 손잡이 자리
const hintSpace = 56;
// 그림 판 1칸이 차지하는 가장 큰 px. 큰 창에서도 프로도가 화면을 다 덮지 않아요.
const maxScale = 2.4;
// 파일 칸을 프로도 아래에 둘 때 프로도가 쓰는 높이의 몫. 나머지는 먹은 방 파일 칸이에요.
const narrowShare = 0.56;
// 이 폭부터 파일 칸을 프로도 오른쪽에 둬요.
const sideBySide = 1000;
// 넓은 창의 파일 칸 폭. 가장 좁아도 종이 몇 장이 한 줄에 들어가요.
const filesMax = 560;
const filesMin = 240;

export type Card = Star & {
  room: Room;
  // 종이 폭과 높이(px)
  size: number;
  height: number;
  rot: number;
  kick: number;
};
// 프로도 그림 상자(px). scale은 그림 판 1칸의 px, mouth는 파일이 나오는 입, floor는 받침 아래 선이에요.
// 먹은 방이 바뀌어도 scale·left·floor는 그대로이고, 몸 길이(top·height)만 바뀌어요.
export type HeroFrodo = { left: number; top: number; width: number; height: number; scale: number; mouth: Point; floor: number };
// 파일 칸 아래 "방 열기" 단추 자리(지도 좌표)와 칸에 다 못 놓은 파일 수.
export type MoreSpot = { room: Room; x: number; y: number; count: number };
// shelf: 위 방 카드 줄(px). rooms: 그 줄에 놓는 방, 순서대로예요.
export type HeroLayout = { shelf: { top: number; height: number } | null; rooms: Room[]; frodo: HeroFrodo | null; cards: Card[]; more: MoreSpot[] };

// 파일이 클수록 큰 종이. 로그 눈금이라 1KB 56, 1MB 76, 1GB 96(1280 기준)입니다. 가장 작아도 이름이 찍혀요(ObjectShape).
export const paperWidth = (bytes: number, unit: number) => (56 + 40 * sizeRatio(bytes)) * unit;

const headerBottom = (view: View) => (view.w < 720 ? 112 : view.w < 1200 ? 100 : 74);
// 현관 줄의 높이. styles.css의 .doorstep 한 줄에 맞춰요.
const doorHeight = 118;
const doorBottom = (view: View) => headerBottom(view) + doorHeight;

export const homeRooms = (rooms: Room[]) => rooms.filter((room) => !room.care.done).slice(0, homeLimit);

// 먹은 방의 몸 길이. 아무것도 안 먹었으면 마디가 없어요.
export const fedLengths = (room: Room | undefined) => (room ? [ductLength(roomUsage(room).totalBytes)] : []);

// selectedId: 프로도가 먹은 방. 그 방 파일만 칸에 놓아요.
export function heroLayout(rooms: Room[], now: number, view: View, aspect: (thing: Thing) => number, doorOpen = false, selectedId: string | null = null): HeroLayout {
  const active = homeRooms(rooms);
  if (active.length === 0) return { shelf: null, rooms: [], frodo: null, cards: [], more: [] };
  const unit = stageUnit(view);
  const paperUnit = Math.max(unit, smallUnit);
  const gap = Math.max(6, 10 * unit);
  const shelf = { top: (doorOpen ? doorBottom(view) : headerBottom(view)) + edge, height: shelfHeight(view) };
  const top = shelf.top + shelf.height + gap;
  const room = active.find((item) => item.id === selectedId);

  // 크기는 가장 길게 자란 몸에 맞춰 정해 두고, 먹은 만큼의 몸을 같은 크기로 받침 위에 세워요. 그래야 먹을 때 프로도가 줄었다 커졌다 하지 않아요.
  const full = stackGeometry([1]).box;
  const [bx, by, bw, bh] = stackGeometry(fedLengths(room)).box;
  // 파일 칸을 프로도 옆에 둘 만큼 넓지 않으면(below) 프로도 아래에 둬요. 그때 일력이 있으면 받침이 일력보다 위에 서요.
  const below = view.w < sideBySide;
  const [calendar] = calendarSpot(view);
  const above = calendar && below ? calendar.y - calendar.hh - edge : view.h - hintSpace;
  const tall = Math.max(1, below ? Math.min((view.h - hintSpace - top) * narrowShare, above - top) : above - top);
  // 프로도는 늘 창 가운데에 서요. 넓은 창은 파일 칸이 프로도 오른쪽에 들어가도록 프로도 크기를 맞춰요.
  // 일력이 왼쪽 아래에 있으면 받침이 그 위에 서지 않게만 오른쪽으로 비켜요.
  const leftMin = calendar && !below ? calendar.x + calendar.hw + edge : edge;
  const across = below ? view.w - 2 * edge : view.w - 2 * (filesMin + 2 * edge);
  const scale = Math.min(maxScale, tall / full[3], across / full[2]);
  const width = bw * scale;
  const left = Math.max(below ? edge : leftMin, (view.w - width) / 2);
  const filesWidth = below ? 0 : Math.max(moreWidth, Math.min(filesMax, view.w - edge - (left + width + 2 * edge)));
  const floor = top + tall;
  const height = bh * scale;
  const frodoTop = floor - height;
  const px = (x: number, y: number): Point => ({ x: left + (x - bx) * scale, y: frodoTop + (y - by) * scale });
  const frodo: HeroFrodo = { left, top: frodoTop, width, height, scale, mouth: px(...stackGeometry(fedLengths(room)).mouth), floor };

  const cards: Card[] = [];
  const more: MoreSpot[] = [];
  const base = { shelf, rooms: active, frodo };
  if (!room) return { ...base, cards, more };

  // 먹은 방 파일 칸. 넓은 창은 프로도 오른쪽, 좁은 창은 프로도 아래예요.
  const span = below
    ? { left: edge, right: view.w - edge, top: floor + gap, bottom: view.h - edge }
    : { left: left + width + 2 * edge, right: left + width + 2 * edge + filesWidth, top: Math.max(top, frodo.mouth.y), bottom: view.h - edge };
  const stars = roomStars(room, frodo.mouth, 0, now, room.things.length).sort((a, b) => lastActivity(b.thing) - lastActivity(a.thing) || b.thing.size - a.thing.size);
  // 칸이 낮은 폰에서는 한 줄과 단추가 들어가도록 종이를 줄입니다. 반올림으로 1px 넘치지 않게 조금 덜어 둡니다.
  const tallestPaper = Math.max(24, span.bottom - span.top - gap - moreHeight - 1);
  const sized = stars.map((star) => {
    let size = Math.min(paperWidth(star.thing.size, paperUnit), span.right - span.left);
    const ratio = size >= 40 ? aspect(star.thing) : 1;
    size = Math.floor(size * ratio > tallestPaper ? tallestPaper / ratio : size);
    return { star, size, height: size >= 40 ? Math.round(size * aspect(star.thing)) : size };
  });

  // 왼쪽부터 채우고, 폭을 넘으면 다음 줄로 내려요. 줄 안에서는 바닥을 맞춥니다.
  const space = span.right - span.left;
  const build = (from: number) => {
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
  let y = span.top;
  let shown = 0;
  while (shown < sized.length) {
    const row = build(shown);
    // 맨 아래 "방 열기" 단추 자리는 늘 남겨 둡니다.
    if (row.items.length === 0 || y + row.height + gap + moreHeight > span.bottom) break;
    let cursor = (span.left + span.right) / 2 - row.width / 2;
    for (const { star, size, height } of row.items) {
      const id = star.thing.id;
      const center = { x: cursor + size / 2, y: y + row.height - height / 2 };
      cards.push({ ...star, ...toSky(center, view), room, size, height, rot: 0, kick: (hash(id, 24) < 0.5 ? -1 : 1) * (6 + 8 * hash(id, 25)) });
      cursor += size + gap;
    }
    shown += row.items.length;
    y += row.height + gap;
  }
  more.push({ room, ...toSky({ x: (span.left + span.right) / 2, y: y + moreHeight / 2 }, view), count: sized.length - shown });
  return { ...base, cards, more };
}
