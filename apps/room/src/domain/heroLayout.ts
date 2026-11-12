import { ductLength, stackGeometry } from "../art/duct";
import { lastActivity, roomUsage, sizeRatio } from "./care";
import type { Room, Thing } from "./model";
import { calendarSpot, hash, homeLimit, roomStars, stageUnit, toSky, type Point, type Star, type View } from "./sky";

// 첫 화면 배치: 프로도 한 명이 받침 위에 서고, 먹은 방마다 그 방 용량만큼 몸이 길어요. 몸 옆에 방 이름 목록이 고른 간격으로 붙어요.
// 고른 방의 파일은 넓은 창에서는 프로도 오른쪽, 좁은 창에서는 프로도 아래 칸에 최근 작업 순서로 놓이고, 칸 아래에 "방 열기"가 붙어요.

// 이름이 찍히는 가장 작은 종이 폭(글자는 8.5px 아래로 줄지 않아요).
export const namedPaper = 46;
const smallUnit = namedPaper / 56;
const edge = 16;
// "방 열기 · +N개 더" 한 줄의 높이(styles.css .room-more)
export const moreHeight = 32;
const moreWidth = 96;
// 몸 옆 이름표 폭. styles.css .seg-tag의 최대 폭과 맞춰요.
export const tagWidth = (view: View) => (view.w < 720 ? 132 : 200);
// 방 목록 한 줄의 높이. 손가락으로 누를 수 있게 44 아래로 줄이지 않아요.
export const tagRow = (view: View) => (view.w < 720 ? 44 : 52);
// 화면 아래 가운데 "형식별로 보기" 손잡이 자리
const hintSpace = 56;
// 그림 판 1칸이 차지하는 가장 큰 px. 방이 하나뿐이어도 프로도가 화면을 다 덮지 않아요.
const maxScale = 2.4;
// 좁은 창에서 프로도가 쓰는 높이의 몫. 나머지는 고른 방 파일 칸이에요.
const narrowShare = 0.56;
// 넓은 창의 파일 칸 폭
const filesMax = 560;

export type Card = Star & {
  room: Room;
  // 종이 폭과 높이(px)
  size: number;
  height: number;
  rot: number;
  kick: number;
};
// 마디 하나(px). 몸에 칸으로 그리지 않고, 처음 켤 때 방을 먹으며 솟는 높이를 재는 데만 써요. tagY는 그 방 이름 줄의 가운데예요.
export type HeroSeg = { room: Room; top: number; bottom: number; left: number; right: number; tagY: number };
// 프로도 그림 상자(px)와 마디들. scale은 그림 판 1칸의 px, mouth는 파일이 나오는 입이에요.
export type HeroFrodo = { left: number; top: number; width: number; height: number; scale: number; mouth: Point; tagX: number; segs: HeroSeg[] };
// 파일 칸 아래 "방 열기" 단추 자리(지도 좌표)와 칸에 다 못 놓은 파일 수.
export type MoreSpot = { room: Room; x: number; y: number; count: number };
export type HeroLayout = { frodo: HeroFrodo | null; cards: Card[]; more: MoreSpot[] };

// 파일이 클수록 큰 종이. 로그 눈금이라 1KB 56, 1MB 76, 1GB 96(1280 기준)입니다. 가장 작아도 이름이 찍혀요(ObjectShape).
export const paperWidth = (bytes: number, unit: number) => (56 + 40 * sizeRatio(bytes)) * unit;

const headerBottom = (view: View) => (view.w < 720 ? 112 : view.w < 1200 ? 100 : 74);
// 현관 줄의 높이. styles.css의 .doorstep 한 줄에 맞춰요.
const doorHeight = 118;
const doorBottom = (view: View) => headerBottom(view) + doorHeight;

export const homeRooms = (rooms: Room[]) => rooms.filter((room) => !room.care.done).slice(0, homeLimit);

// selectedId: 고른 방. 그 방 파일만 칸에 놓아요. 프로도 자리는 고르든 말든 같고, 다가가는 건 카메라(SkyMap)가 맡아요.
export function heroLayout(rooms: Room[], now: number, view: View, aspect: (thing: Thing) => number, doorOpen = false, selectedId: string | null = null): HeroLayout {
  const active = homeRooms(rooms);
  if (active.length === 0) return { frodo: null, cards: [], more: [] };
  const narrow = view.w < 720;
  const unit = stageUnit(view);
  const paperUnit = Math.max(unit, smallUnit);
  const gap = Math.max(6, 10 * unit);
  const top = (doorOpen ? doorBottom(view) : headerBottom(view)) + edge;
  const floor = view.h - hintSpace;
  const tag = tagWidth(view);

  const geo = stackGeometry(active.map((room) => ductLength(roomUsage(room).totalBytes)));
  const [bx, by, bw, bh] = geo.box;
  const tall = Math.max(1, (narrow ? (floor - top) * narrowShare : floor - top));
  // 그림 판 오른쪽 끝이 아니라 몸 오른쪽 끝에서 이름표가 시작해요.
  const across = (s: number) => Math.max(bw * s, (geo.right - bx) * s + gap + tag);
  let scale = Math.min(maxScale, tall / bh);
  scale = Math.min(scale, (view.w - 2 * edge) / across(1));
  const column = across(scale);
  // 일력이 왼쪽 아래에 있으면 받침이 그 위에 서지 않게 오른쪽으로 비켜요.
  const [calendar] = calendarSpot(view);
  const leftMin = calendar ? calendar.x + calendar.hw + edge : edge;
  const left = narrow ? (view.w - column) / 2 : Math.max(leftMin, (view.w - column) / 2);
  const height = bh * scale;
  const frodoTop = narrow ? top : floor - height;
  const px = (x: number, y: number): Point => ({ x: left + (x - bx) * scale, y: frodoTop + (y - by) * scale });
  const mouth = px(...geo.mouth);
  // 이름 목록은 입과 받침 사이 가운데에 둬요. 그 사이에 다 안 들어가면 머리 위 칸(top)을 넘지 않는 데까지 올려요.
  const row = tagRow(view);
  const listTop = Math.max(top, (mouth.y + frodoTop + height - active.length * row) / 2);
  const segs = active.map((room, i) => {
    const seg = geo.segs[i];
    return { room, top: px(0, seg.top).y, bottom: px(0, seg.bottom).y, left: px(seg.left, 0).x, right: px(seg.right, 0).x, tagY: listTop + (i + 0.5) * row };
  });
  const frodo: HeroFrodo = { left, top: frodoTop, width: bw * scale, height, scale, mouth, tagX: px(geo.right, 0).x + gap, segs };

  const cards: Card[] = [];
  const more: MoreSpot[] = [];
  const room = active.find((item) => item.id === selectedId);
  if (!room) return { frodo, cards, more };

  // 고른 방 파일 칸. 넓은 창은 프로도 오른쪽, 좁은 창은 프로도 아래예요.
  const span = narrow
    ? { left: edge, right: view.w - edge, top: frodoTop + height + gap, bottom: view.h - edge }
    : { left: left + column + 2 * edge, right: left + column + 2 * edge + Math.max(moreWidth, Math.min(filesMax, view.w - column - 4 * edge)), top: Math.max(top, frodo.mouth.y), bottom: view.h - edge };
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
  return { frodo, cards, more };
}
