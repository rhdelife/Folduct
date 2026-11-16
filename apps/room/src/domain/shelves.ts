import type { Kind, Room, Thing } from "./model";
import { hues, type Hue } from "./hue";
import { stacksOf } from "./versions";

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

// 컬러별 칸: 이미지를 가장 넓은 색(found: 파일 id → 색)마다 모아요. 아직 못 읽었거나 색을 못 읽은 이미지는 빠져요.
export function hueShelves(items: ShelfItem[], found: Map<string, Hue | null>): Shelf[] {
  return hues.map((hue) => ({ ...pack(hue, ["image"], items.filter((item) => found.get(item.thing.id) === hue)), hue })).filter((shelf) => shelf.items.length > 0);
}
