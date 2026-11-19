import { relativeDay } from "./care";
import { newId, storedKind, type Kind, type Room, type ScannedFile } from "./model";
import { samePath } from "./platform";

// 현관: 어느 방에도 속하지 않은 폴더(다운로드 등)에 새로 생긴 문서를 모아 둡니다. 화면·저장소와 무관한 순수 함수만 둡니다.
// path는 폴더 바로 아래의 디스크 이름 그대로입니다. name은 화면에 쓰는 NFC 이름이에요.
export type DoorItem = { id: string; folder: string; path: string; name: string; kind: Kind; size: number; lastModified: number; since: number };

// 함께 바뀌어야 하는 값들이라 한 덩어리로 저장합니다. seen은 폴더별로 지난번에 본 이름, readAt은 마지막으로 폴더를 읽은 시각입니다.
export type Doorstep = { folders: string[]; seen: Record<string, string[]>; items: DoorItem[]; readAt: number | null };

export type DoorRead = { present: string[]; found: ScannedFile[] };

export const emptyDoorstep: Doorstep = { folders: [], seen: {}, items: [], readAt: null };

const partialEnds = [".crdownload", ".download", ".part", ".tmp"];

// 받는 중이거나 다른 앱이 열어 둔 임시 파일. 끝나면 진짜 이름으로 바뀌어 그때 새 문서가 됩니다.
export function isPartialFile(name: string): boolean {
  const lower = name.toLowerCase();
  return name.startsWith("~$") || partialEnds.some((end) => lower.endsWith(end));
}

// 시각이 아니라 이름으로 가립니다. 옛 날짜를 달고 들어온 복사본도 잡고, 전부터 있던 파일을 고친 것은 새 문서로 치지 않아요.
// 처음 읽는 폴더(seen 없음)는 기준만 잡습니다. 다운로드 폴더 전체가 새 문서가 되면 안 되니까요.
export function isNewName(name: string, seen: ReadonlySet<string> | undefined): boolean {
  return seen !== undefined && !seen.has(name);
}

// 읽은 결과를 합칩니다. 그사이 빠진 폴더는 무시하고, 폴더에서 사라진 문서는 줄에서도 뺍니다.
export function settleFolder(state: Doorstep, folder: string, read: DoorRead, now: number): Doorstep {
  if (!state.folders.includes(folder)) return state;
  const present = new Set(read.present);
  const items = state.items.filter((item) => item.folder !== folder || present.has(item.path));
  const held = new Set(items.filter((item) => item.folder === folder).map((item) => item.path));
  const since = state.readAt ?? now;
  const added = read.found.filter((file) => !held.has(file.path)).map((file): DoorItem => ({ id: newId(), folder, path: file.path, name: file.name, kind: file.kind, size: file.size, lastModified: file.lastModified, since }));
  return { ...state, seen: { ...state.seen, [folder]: read.present }, items: [...items, ...added] };
}

export function addFolder(state: Doorstep, folder: string, read: DoorRead): Doorstep {
  if (state.folders.includes(folder)) return state;
  return { ...state, folders: [...state.folders, folder], seen: { ...state.seen, [folder]: read.present } };
}

export function removeFolder(state: Doorstep, folder: string): Doorstep {
  const { [folder]: _, ...seen } = state.seen;
  return { ...state, folders: state.folders.filter((item) => item !== folder), seen, items: state.items.filter((item) => item.folder !== folder) };
}

// '그대로 두기': 줄에서만 뺍니다. seen에는 남아서 다음에 켜도 다시 올라오지 않아요.
export function dropItem(state: Doorstep, id: string): Doorstep {
  return { ...state, items: state.items.filter((item) => item.id !== id) };
}

// 방으로 옮긴 뒤: 줄과 목록에서 함께 뺍니다. 같은 이름을 다시 받으면 새 문서여야 하니까요.
// 옮기기 전에는 아무것도 적지 않습니다. 도중에 꺼져도 다음에 폴더를 읽을 때 파일이 있으면 줄에 남고, 없으면 settleFolder가 뺍니다.
export function settleMoved(state: Doorstep, item: DoorItem): Doorstep {
  const seen = state.seen[item.folder];
  return { ...dropItem(state, item.id), seen: seen ? { ...state.seen, [item.folder]: seen.filter((name) => name !== item.path) } : state.seen };
}

export function restoreItem(state: Doorstep, item: DoorItem): Doorstep {
  if (!state.folders.includes(item.folder) || state.items.some((other) => other.id === item.id)) return state;
  const seen = state.seen[item.folder] ?? [];
  return { ...state, seen: { ...state.seen, [item.folder]: seen.includes(item.path) ? seen : [...seen, item.path] }, items: [...state.items, item] };
}

// 문서를 받을 수 있는 방: 실제 폴더가 연결되어 있고 진행 중인 방. 최근 쓴 방부터 보여 줍니다.
export function doorTargets(rooms: Room[], item: DoorItem): Room[] {
  const lastUsed = (room: Room) => room.workDays.at(-1) ?? "";
  return rooms
    .filter((room) => room.source === "handle" && room.origin && !room.care.done && !samePath(room.origin, item.folder))
    .sort((a, b) => lastUsed(b).localeCompare(lastUsed(a)) || b.createdAt - a.createdAt);
}

// macOS가 붙이는 스크린샷 이름(한국어·영어). 작업 중 스크린샷은 방 안 '스크린샷/날짜' 폴더로 모아요(2026-11-19 요청).
export function isScreenshotName(name: string): boolean {
  return /^(스크린샷|Screenshot|Screen Shot) \d{4}-\d{2}-\d{2}/.test(name.normalize("NFC"));
}

export function newestFirst(items: DoorItem[]): DoorItem[] {
  return [...items].sort((a, b) => b.lastModified - a.lastModified);
}

export function doorTitle(items: DoorItem[], now: number): string {
  const when = relativeDay(Math.min(...items.map((item) => item.since)), now);
  return `${when === "오늘" ? "오늘" : `${when}부터`} 새 문서 ${items.length}개`;
}

// 저장한 적이 없거나 모양이 어긋나면 기본값으로 채웁니다.
export function normalizeDoorstep(value: unknown): Doorstep {
  const state = (value ?? {}) as Partial<Doorstep>;
  return {
    folders: Array.isArray(state.folders) ? state.folders.filter((folder) => typeof folder === "string") : [],
    seen: state.seen && typeof state.seen === "object" ? state.seen : {},
    // 망가진 줄 하나가 집 화면 전체를 멈추지 않게, 그릴 수 없는 줄만 뺍니다.
    items: Array.isArray(state.items) ? state.items.filter((item) => typeof item?.id === "string" && typeof item.folder === "string" && typeof item.path === "string" && typeof item.name === "string").map((item) => ({ ...item, kind: storedKind(item.kind, item.name) })) : [],
    readAt: typeof state.readAt === "number" ? state.readAt : null,
  };
}
