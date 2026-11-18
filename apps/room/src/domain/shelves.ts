import type { Kind, Room, Thing } from "./model";
import { hues, type Hue } from "./hue";
import { stacksOf } from "./versions";
import type { Drawer } from "./shelfViews";
import { formatMB, formatMinutes, rangeText } from "./stepRange";

// 홈 아래 형식별 칸: 홈에 둔 모든 방의 파일을 형식 묶음(이미지·글·영상…)으로 나눠요. 새로 고친 것부터예요.
// 상자에 든 파일과 사라진 파일은 빼고, 버전 계열은 최신본만 둬요(versions는 그 계열의 버전 수, 혼자면 1).
export type ShelfItem = { room: Room; thing: Thing; versions: number; durationSeconds?: number };
// hue는 컬러별 칸만 가져요(서랍 색이 형식 색 대신 그 색 네모예요).
export type Shelf = { id?: string; label: string; kinds: Kind[]; items: ShelfItem[]; size: number; hue?: Hue };

// 홈에 둔 방들의 파일 중 칸에 놓을 것(상자·사라진 파일·옛 버전 빼고).
export function shelfItems(rooms: Room[]): ShelfItem[] {
  return rooms
    .filter((room) => !room.care.done)
    .flatMap((room) => {
      const { top, under } = stacksOf(room.things);
      return room.things.filter((thing) => !thing.box && !thing.missing && !under.has(thing.id)).map((thing) => ({ room, thing, versions: top.get(thing.id)?.length ?? 1 }));
    });
}

const pack = (label: string, kinds: Kind[], items: ShelfItem[]): Shelf => {
  const list = [...items].sort((a, b) => b.thing.lastModified - a.thing.lastModified);
  return { label, kinds, items: list, size: list.reduce((sum, item) => sum + item.thing.size, 0) };
};

export function kindShelves(rooms: Room[], groups: { label: string; kinds: Kind[] }[]): Shelf[] {
  const items = shelfItems(rooms);
  return groups.map(({ label, kinds }) => pack(label, kinds, items.filter((item) => kinds.includes(item.thing.kind)))).filter((shelf) => shelf.items.length > 0);
}

// 영상 길이 표(파일 → 초)의 열쇠. 파일을 고치면 다시 읽어요.
export const secondsKey = (item: ShelfItem) => `${item.room.id}:${item.thing.path}:${item.thing.lastModified}`;
const extOf = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "");
const MB = 1024 ** 2;

// 사용자 서랍 조건(shelfViews Drawer)에 맞는지. 조건은 모두 맞아야 해요.
export function fitsDrawer(drawer: Drawer, item: ShelfItem, seconds: Map<string, number | null>): boolean {
  const { kinds, exts = [], minMB, maxMB, minMin, maxMin } = drawer;
  if (kinds.length === 0 && exts.length === 0 && minMB === undefined && maxMB === undefined && minMin === undefined && maxMin === undefined) return false;
  const { thing } = item;
  if (kinds.length > 0 && !kinds.includes(thing.kind)) return false;
  if (exts.length > 0 && !exts.includes(extOf(thing.name))) return false;
  if (minMB !== undefined && thing.size < minMB * MB) return false;
  if (maxMB !== undefined && thing.size >= maxMB * MB) return false;
  if (minMin !== undefined || maxMin !== undefined) {
    const length = seconds.get(secondsKey(item));
    if (length === undefined || length === null) return false;
    if (minMin !== undefined && length < minMin * 60) return false;
    if (maxMin !== undefined && length >= maxMin * 60) return false;
  }
  return true;
}

// 사용자 서랍장: 서랍마다 조건에 맞는 파일을 모아요. 한 파일이 여러 서랍에 들 수 있어요. 빈 서랍은 빼요.
// 서랍 색은 고른 첫 형식, 형식을 안 골랐으면 담긴 파일 중 가장 새 파일의 형식 색이에요.
export function drawerShelves(rooms: Room[], drawers: Drawer[], seconds: Map<string, number | null>): Shelf[] {
  const items = shelfItems(rooms);
  return drawers
    .map((drawer) => {
      const shelf = { ...pack(drawer.name, drawer.kinds, items.filter((item) => fitsDrawer(drawer, item, seconds))), id: drawer.id };
      return shelf.kinds.length > 0 || shelf.items.length === 0 ? shelf : { ...shelf, kinds: [shelf.items[0].thing.kind] };
    })
    .filter((shelf) => shelf.items.length > 0);
}

// 길이 조건이 있는 서랍이 하나라도 있으면 영상 길이를 읽어야 해요.
export const needsSeconds = (drawers: Drawer[]) => drawers.some((drawer) => drawer.minMin !== undefined || drawer.maxMin !== undefined);

// null은 읽을 수 없는 파일, undefined는 아직 읽는 중인 파일이에요.
export function hueShelves(items: ShelfItem[], found: Map<string, Hue | null>, kind: "image" | "video" = "image"): Shelf[] {
  const media = items.filter(({ thing }) => thing.kind === kind);
  return hues.map((hue) => ({ ...pack(hue, [kind], media.filter((item) => found.get(item.thing.id) === hue)), hue })).filter((shelf) => shelf.items.length > 0);
}

export function unreadHueShelf(items: ShelfItem[], found: Map<string, Hue | null>, kind: "image" | "video"): Shelf[] {
  const unread = items.filter(({ thing }) => thing.kind === kind && found.get(thing.id) === null);
  return unread.length ? [pack("색 미확인", [], unread)] : [];
}

function rangeShelves(items: ShelfItem[], kinds: Kind[], cuts: number[], measure: (item: ShelfItem) => number | null | undefined, format: (value: number) => string): Shelf[] {
  const groups: ShelfItem[][] = Array.from({ length: cuts.length + 1 }, () => []);
  const unknown: ShelfItem[] = [];
  for (const item of items) {
    const value = measure(item);
    if (value === undefined) continue;
    if (value === null) unknown.push(item);
    else {
      const at = cuts.findIndex((cut) => value < cut);
      groups[at === -1 ? cuts.length : at].push(item);
    }
  }
  const shelves = groups.flatMap((group, index) => group.length ? [pack(rangeText(cuts[index - 1], cuts[index], format), kinds, group)] : []);
  return unknown.length ? [...shelves, pack("길이 미확인", kinds, unknown)] : shelves;
}

export function videoLengthShelves(items: ShelfItem[], seconds: Map<string, number | null>): Shelf[] {
  const videos = items.filter(({ thing }) => thing.kind === "video").map((item) => {
    const length = seconds.get(secondsKey(item));
    return typeof length === "number" ? { ...item, durationSeconds: length } : item;
  });
  return rangeShelves(videos, ["video"], [1, 5, 30], (item) => item.durationSeconds === undefined ? seconds.get(secondsKey(item)) : item.durationSeconds / 60, formatMinutes);
}

export function sizeShelves(items: ShelfItem[]): Shelf[] {
  return rangeShelves(items, [], [1, 100, 1024], ({ thing }) => thing.size / MB, formatMB);
}

// 서랍장 편집 창이 고르는 대로 바로 보여 주는 셈들이에요.
export function drawerStats(drawer: Drawer, items: ShelfItem[], seconds: Map<string, number | null>): { count: number; size: number } {
  const fit = items.filter((item) => fitsDrawer(drawer, item, seconds));
  return { count: fit.length, size: fit.reduce((sum, item) => sum + item.thing.size, 0) };
}

// 어느 서랍에도 안 담기는 파일.
export const leftoverItems = (drawers: Drawer[], items: ShelfItem[], seconds: Map<string, number | null>): ShelfItem[] =>
  items.filter((item) => !drawers.some((drawer) => fitsDrawer(drawer, item, seconds)));

export function kindCounts(items: ShelfItem[]): Map<Kind, number> {
  const counts = new Map<Kind, number>();
  for (const { thing } of items) counts.set(thing.kind, (counts.get(thing.kind) ?? 0) + 1);
  return counts;
}

// 고른 형식(없으면 모두) 파일에 실제로 있는 확장자와 개수, 많은 것부터.
export function extCounts(items: ShelfItem[], kinds: Kind[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const { thing } of items) {
    const ext = extOf(thing.name);
    if (ext && (kinds.length === 0 || kinds.includes(thing.kind))) counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
