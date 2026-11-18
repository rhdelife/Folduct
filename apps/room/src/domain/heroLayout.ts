import { ductLength, stackGeometry } from "../art/duct";
import { lastActivity, roomUsage, sizeRatio } from "./care";
import type { Kind, Room, Thing } from "./model";
import { pileKey } from "./pile";
import { isSearching, matchesPath, searchOrder } from "./search";
import { calendarSpot, hash, homeLimit, roomStars, stageUnit, toSky, type Point, type Star, type View } from "./sky";
import { stacksOf } from "./versions";

// 첫 화면 배치: 위에 방(프로젝트) 카드 한 줄, 그 아래 받침 위에 선 프로도 한 명.
// 방 카드를 프로도에게 먹이면 그 방 용량만큼 몸이 늘어나고, 그 방 파일이 넓은 창에서는 프로도 오른쪽, 좁은 창에서는 프로도 아래 칸에
// 놓여요. 칸 맨 위에는 찾기 줄이 있어 이름·폴더·형식으로 바로 좁혀요. 아무것도 안 먹은 프로도는 목만 내민 짧은 몸이에요.

// 이름이 찍히는 가장 작은 종이 폭(글자는 8.5px 아래로 줄지 않아요).
export const namedPaper = 46;
const smallUnit = namedPaper / 56;
const edge = 16;
// 파일 칸 맨 위 찾기 줄 두 단의 높이(styles.css .fed-find: 찾기 칸 32 + 8 + 형식 28)
export const findHeight = 68;
// 위 방 카드 줄의 높이. styles.css .room-shelf(--shelf-cover)와 맞춰요.
export const shelfHeight = (view: View) => (view.w < 720 ? 92 : 124);
// 화면 아래 가운데에 비워 둘 자리. 좁은 창(720 이하)은 홈 | Drawer 알약이 거기 떠 있어요. 넓은 창은 아래가 비어 있어 0이에요.
const bottomSpace = (view: View) => (view.w <= 720 ? 56 : 0);
const minFilesHeight = 48;
// 그림 판 1칸이 차지하는 가장 큰 px. 큰 창에서도 프로도가 화면을 다 덮지 않아요.
const maxScale = 2.4;
// 가장 길게 자라도 빈자리를 다 채우지 않게 조금 작게 그려요.
const shrink = 0.88;
// 파일 칸을 프로도 아래에 둘 때 프로도가 쓰는 높이의 몫. 나머지는 먹은 방 파일 칸이에요.
const narrowShare = 0.56;
// 이 폭부터 파일 칸을 프로도 오른쪽에 둬요. 1280 창에서 미리보기 창이 열려 판이 좁아져도(약 880) 파일 칸이 프로도 아래로 뛰어내리지 않게 낮춰 뒀어요.
const sideBySide = 860;
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
// 먹은 방이 바뀌어도 scale·left는 그대로예요. 프로도를 빈자리 가운데에 두니 몸이 늘면 받침이 그 절반만큼 내려가요.
export type HeroFrodo = { left: number; top: number; width: number; height: number; scale: number; mouth: Point; floor: number };
// 찾기 줄과 스크롤되는 파일 칸의 자리(px). visible은 처음 화면에 온전히 들어가는 파일 수예요.
export type FindSpot = { room: Room; left: number; top: number; width: number; filesTop: number; bottom: number; visible: number };
// 먹은 방에서 고를 것: 찾는 말(이름·폴더)과 형식 묶음(색 띠 하나의 형식들).
export type FedFilter = { query: string; kinds: readonly Kind[] | null };
// shelf: 위 방 카드 줄(px). rooms: 그 줄에 놓는 방, 순서대로예요.
export type HeroLayout = { shelf: { top: number; height: number } | null; rooms: Room[]; frodo: HeroFrodo | null; cards: Card[]; find: FindSpot | null };

// 파일이 클수록 큰 종이. 로그 눈금이라 1KB 56, 1MB 76, 1GB 96(1280 기준)입니다. 가장 작아도 이름이 찍혀요(ObjectShape).
export const paperWidth = (bytes: number, unit: number) => (56 + 40 * sizeRatio(bytes)) * unit;

const headerBottom = (view: View) => (view.w < 720 ? 112 : view.w < 1200 ? 100 : 74);
// 현관 줄의 높이. styles.css의 .doorstep 한 줄에 맞춰요.
const doorHeight = 118;
const doorBottom = (view: View) => headerBottom(view) + doorHeight;

export const homeRooms = (rooms: Room[]) => rooms.filter((room) => !room.care.done).slice(0, homeLimit);

// 먹은 방의 몸 길이. 아무것도 안 먹었으면 마디가 없어요.
export const fedLengths = (room: Room | undefined) => (room ? [ductLength(roomUsage(room).totalBytes)] : []);

// 먹은 방 파일을 놓을 순서. 상자 속·없어진 파일은 빼요.
// 찾는 말이나 형식이 있으면 맞는 파일만, 방 안 찾기와 같은 순위(이름에 맞은 파일·얕은 파일 먼저)예요.
// 없으면 사람이 찾는 파일(자동 생성·보관 폴더 더미도, 옛 버전도 아닌 파일)부터 최근 작업 순이고, 나머지는 그 뒤예요.
export function fedThings(room: Room, { query, kinds }: FedFilter): Thing[] {
  const live = room.things.filter((thing) => !thing.missing && !thing.box);
  if (isSearching(query) || kinds) return live.filter((thing) => matchesPath(thing, query) && (!kinds || kinds.includes(thing.kind))).sort(searchOrder(query));
  const { under } = stacksOf(live);
  const front = (thing: Thing) => (under.has(thing.id) || (!thing.pinned && pileKey(thing.path) !== null) ? 1 : 0);
  return live.sort((a, b) => front(a) - front(b) || lastActivity(b) - lastActivity(a) || b.size - a.size);
}

// selectedId: 프로도가 먹은 방. 그 방 파일만 칸에 놓아요.
export function heroLayout(rooms: Room[], now: number, view: View, aspect: (thing: Thing) => number, doorOpen = false, selectedId: string | null = null, filter: FedFilter = { query: "", kinds: null }, lead = 0): HeroLayout {
  const active = homeRooms(rooms);
  if (active.length === 0) return { shelf: null, rooms: [], frodo: null, cards: [], find: null };
  const unit = stageUnit(view);
  const paperUnit = Math.max(unit, smallUnit);
  const gap = Math.max(6, 10 * unit);
  const room = active.find((item) => item.id === selectedId);
  // 미리보기 창이 열리면 파일 칸을 프로도 아래로 내려, 남은 폭을 다 쓰고 프로도 옆을 말풍선 자리로 비워요(2026-11-19 요청).
  const below = view.w < sideBySide || Boolean(view.pane);
  const bottom = view.h - edge - bottomSpace(view);
  // 현관 줄은 왼쪽 아래 탭이 없는 좁은 창에서만 머리 아래에 펼쳐져요. 넓은 창에서는 '진행 중' 탭 안에 있어요.
  // lead: 방 카드 줄 위에 비워 둘 높이(분류 칩 줄).
  const shelfH = shelfHeight(view);
  // 낮은 창에서 방을 먹이면 숨은 현관 줄의 높이를 파일 칸에 돌려줘요.
  const doorFits = !room || !below || doorBottom(view) + edge + lead + shelfH + findHeight + minFilesHeight + 2 * gap < bottom;
  const shelf = { top: (doorOpen && doorFits && calendarSpot(view).length === 0 ? doorBottom(view) : headerBottom(view)) + edge + lead, height: shelfH };
  const top = shelf.top + shelf.height + gap;

  // 크기는 가장 길게 자란 몸에 맞춰 정해 두고, 먹은 만큼의 몸을 같은 크기로 받침 위에 세워요. 그래야 먹을 때 프로도가 줄었다 커졌다 하지 않아요.
  const full = stackGeometry([1]).box;
  const [bx, by, bw, bh] = stackGeometry(fedLengths(room)).box;
  // 파일 칸을 프로도 옆에 둘 만큼 넓지 않으면(below) 프로도 아래에 둬요. 그때 일력이 있으면 받침이 일력보다 위에 서요.
  const [calendar] = calendarSpot(view);
  const above = calendar && below ? calendar.y - calendar.hh - edge : view.h - bottomSpace(view);
  const forFiles = bottom - top - findHeight - minFilesHeight - 2 * gap;
  const tall = Math.max(1, below ? Math.min((view.h - bottomSpace(view) - top) * narrowShare, above - top, forFiles) : above - top);
  // 프로도를 빈자리(방 카드 줄 아래) 가운데에 둬요. 좁은 창에서 방을 먹으면 아래에 파일 칸이 오니 위쪽 몫(tall) 가운데로 올라가요.
  const area = room || !below ? tall : Math.max(1, above - top);
  // 프로도는 늘 창 가운데에 서요. 넓은 창은 파일 칸이 프로도 오른쪽에 들어가도록 프로도 크기를 맞춰요.
  // 일력이 왼쪽 아래에 있으면 받침이 그 위에 서지 않게만 오른쪽으로 비켜요.
  const leftMin = calendar && !below ? calendar.x + calendar.hw + edge : edge;
  const across = below ? view.w - 2 * edge : view.w - 2 * (filesMin + 2 * edge);
  const scale = shrink * Math.min(maxScale, tall / full[3], across / full[2]);
  const width = bw * scale;
  const left = Math.max(below ? edge : leftMin, (view.w - width) / 2);
  const filesWidth = Math.min(filesMax, view.w - edge - (left + width + 2 * edge));
  const height = bh * scale;
  const floor = top + (area + height) / 2;
  const frodoTop = floor - height;
  const px = (x: number, y: number): Point => ({ x: left + (x - bx) * scale, y: frodoTop + (y - by) * scale });
  const frodo: HeroFrodo = { left, top: frodoTop, width, height, scale, mouth: px(...stackGeometry(fedLengths(room)).mouth), floor };

  const cards: Card[] = [];
  const base = { shelf, rooms: active, frodo };
  if (!room) return { ...base, cards, find: null };

  // 먹은 방 파일 칸. 넓은 창은 프로도 오른쪽, 좁은 창은 프로도 아래예요. 좁은 창은 아래 홈 | Drawer 알약 자리까지 내려가지 않아요.
  const span = below
    ? { left: calendar ? calendar.x + calendar.hw + edge : edge, right: view.w - edge, top: floor + gap, bottom }
    : { left: left + width + 2 * edge, right: left + width + 2 * edge + filesWidth, top: Math.max(top, frodo.mouth.y), bottom };
  // 아주 낮은 창에서도 찾기 줄과 스크롤 칸을 열 수 있게 위로 당겨요.
  span.top = Math.min(span.top, bottom - findHeight - gap - minFilesHeight);
  const byId = new Map(roomStars(room, frodo.mouth, 0, now, room.things.length).map((star) => [star.thing.id, star]));
  const stars = fedThings(room, filter).flatMap((thing) => byId.get(thing.id) ?? []);
  const filesTop = span.top + findHeight + gap / 2;
  const firstRow = filesTop + gap / 2;
  const find: FindSpot = { room, left: span.left, top: span.top, width: span.right - span.left, filesTop, bottom: span.bottom, visible: 0 };
  // 칸이 낮은 폰에서는 한 줄이 들어가도록 종이를 줄입니다. 반올림으로 1px 넘치지 않게 조금 덜어 둡니다.
  const tallestPaper = Math.max(24, span.bottom - firstRow - 1);
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
    for (let index = from; index < sized.length; index += 1) {
      const item = sized[index];
      const next = row.items.length ? row.width + gap + item.size : item.size;
      if (next > space) break;
      row.items.push(item);
      row.width = next;
      row.height = Math.max(row.height, item.height);
    }
    return row;
  };
  let y = firstRow;
  let shown = 0;
  while (shown < sized.length) {
    const row = build(shown);
    if (row.items.length === 0) break;
    let cursor = (span.left + span.right) / 2 - row.width / 2;
    for (const { star, size, height } of row.items) {
      const id = star.thing.id;
      const center = { x: cursor + size / 2, y: y + row.height - height / 2 };
      cards.push({ ...star, ...toSky(center, view), room, size, height, rot: 0, kick: (hash(id, 24) < 0.5 ? -1 : 1) * (6 + 8 * hash(id, 25)) });
      cursor += size + gap;
    }
    shown += row.items.length;
    if (y + row.height <= span.bottom) find.visible = shown;
    y += row.height + gap;
  }
  return { ...base, cards, find };
}
