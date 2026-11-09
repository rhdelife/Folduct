import type { Kind, Room, Thing } from "./model";
import { stacksOf } from "./versions";

// 홈 아래 형식별 칸: 홈에 둔 모든 방의 파일을 형식 묶음(이미지·글·영상…)으로 나눠요. 새로 고친 것부터예요.
// 상자에 든 파일과 사라진 파일은 빼고, 버전 계열은 최신본만 둬요(versions는 그 계열의 버전 수, 혼자면 1).
export type ShelfItem = { room: Room; thing: Thing; versions: number };
export type Shelf = { label: string; kinds: Kind[]; items: ShelfItem[]; size: number };

export function kindShelves(rooms: Room[], groups: { label: string; kinds: Kind[] }[]): Shelf[] {
  const items = rooms
    .filter((room) => !room.care.done)
    .flatMap((room) => {
      const { top, under } = stacksOf(room.things);
      return room.things.filter((thing) => !thing.box && !thing.missing && !under.has(thing.id)).map((thing) => ({ room, thing, versions: top.get(thing.id)?.length ?? 1 }));
    });
  return groups
    .map(({ label, kinds }) => {
      const list = items.filter((item) => kinds.includes(item.thing.kind)).sort((a, b) => b.thing.lastModified - a.thing.lastModified);
      return { label, kinds, items: list, size: list.reduce((sum, item) => sum + item.thing.size, 0) };
    })
    .filter((shelf) => shelf.items.length > 0);
}
