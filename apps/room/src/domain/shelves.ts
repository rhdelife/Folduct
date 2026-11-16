import type { Kind, Room, Thing } from "./model";
import { hues, type Hue } from "./hue";
import { stacksOf } from "./versions";
import type { Drawer } from "./shelfViews";

// 홈 아래 형식별 칸: 홈에 둔 모든 방의 파일을 형식 묶음(이미지·글·영상…)으로 나눠요. 새로 고친 것부터예요.
// 상자에 든 파일과 사라진 파일은 빼고, 버전 계열은 최신본만 둬요(versions는 그 계열의 버전 수, 혼자면 1).
export type ShelfItem = { room: Room; thing: Thing; versions: number };
// hue는 컬러별 칸만 가져요(서랍 색이 형식 색 대신 그 색 네모예요).
export type Shelf = { label: string; kinds: Kind[]; items: ShelfItem[]; size: number; hue?: Hue };

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
      const shelf = pack(drawer.name, drawer.kinds, items.filter((item) => fitsDrawer(drawer, item, seconds)));
      return shelf.kinds.length > 0 || shelf.items.length === 0 ? shelf : { ...shelf, kinds: [shelf.items[0].thing.kind] };
    })
    .filter((shelf) => shelf.items.length > 0);
}

// 길이 조건이 있는 서랍이 하나라도 있으면 영상 길이를 읽어야 해요.
export const needsSeconds = (drawers: Drawer[]) => drawers.some((drawer) => drawer.minMin !== undefined || drawer.maxMin !== undefined);

// 컬러별 칸: 이미지를 가장 넓은 색(found: 파일 id → 색)마다 모아요. 아직 못 읽었거나 색을 못 읽은 이미지는 빠져요.
export function hueShelves(items: ShelfItem[], found: Map<string, Hue | null>): Shelf[] {
  return hues.map((hue) => ({ ...pack(hue, ["image"], items.filter((item) => found.get(item.thing.id) === hue)), hue })).filter((shelf) => shelf.items.length > 0);
}
