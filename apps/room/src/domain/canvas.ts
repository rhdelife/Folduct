import type { CanvasItem, Thing } from "./model";

// 방 판: 빈 캔버스에 필요한 파일·폴더만 꺼내 놓고 자리와 크기를 정해요. 판에서 빼도 실제 파일·폴더는 그대로예요.
// 좌표는 폭 canvasWidth의 논리 판 기준이고, 화면에서는 판 폭에 맞춰 통째로 줄이거나 늘려요(375·720·1280에서 같은 배치).
export const canvasWidth = 1000;
// 크기 1일 때 종이 폭(논리 단위).
export const itemBase = 120;
export const canvasScale = { min: 0.5, max: 2.5 };
// 판이 비어도 이만큼은 높이를 둬요.
export const canvasMinHeight = 560;
export const canvasLimit = 400;
const cell = { w: 160, h: 200, left: 40, top: 30 };

export const fileKey = (id: string) => `t:${id}`;
export const folderKey = (path: string) => `f:${path}`;
export const keyThing = (key: string) => (key.startsWith("t:") ? key.slice(2) : null);
export const keyFolder = (key: string) => (key.startsWith("f:") ? key.slice(2) : null);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number) => Math.round(value * 10) / 10;

export function clampItem(item: CanvasItem): CanvasItem {
  const s = round(clamp(item.s, canvasScale.min, canvasScale.max));
  return { key: item.key, x: round(clamp(item.x, 0, canvasWidth - itemBase * s * 0.5)), y: round(Math.max(0, item.y)), s };
}

// 저장소에서 읽은 판은 믿지 않아요. 열쇠가 이상하거나 겹친 칸은 버리고, 자리·크기는 판 안으로 넣어요. 예전 방(칸 없음)은 빈 판이에요.
export function normalizeCanvas(value: unknown): CanvasItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((raw): CanvasItem[] => {
    const item = (raw ?? {}) as Partial<CanvasItem>;
    if (typeof item.key !== "string" || !/^[tf]:./.test(item.key) || seen.has(item.key)) return [];
    if (![item.x, item.y].every((n) => typeof n === "number" && Number.isFinite(n))) return [];
    seen.add(item.key);
    return [clampItem({ key: item.key, x: item.x!, y: item.y!, s: typeof item.s === "number" && Number.isFinite(item.s) ? item.s : 1 })];
  }).slice(0, canvasLimit);
}

// 새로 꺼낸 것을 놓을 자리: 왼쪽 위부터 칸을 따라 가며 아무것도 가까이 없는 첫 칸이에요.
export function nextSpot(items: CanvasItem[]): { x: number; y: number } {
  const cols = Math.floor((canvasWidth - cell.left) / cell.w);
  for (let at = 0; ; at += 1) {
    const x = cell.left + (at % cols) * cell.w;
    const y = cell.top + Math.floor(at / cols) * cell.h;
    if (!items.some((item) => Math.abs(item.x - x) < cell.w * 0.6 && Math.abs(item.y - y) < cell.h * 0.6)) return { x, y };
  }
}

export function canvasHeight(items: CanvasItem[]): number {
  return Math.max(canvasMinHeight, ...items.map((item) => item.y + itemBase * item.s * 1.6 + cell.top));
}

export type FolderEntry = { path: string; name: string; things: Thing[]; size: number };

// 한 폴더(dir, 맨 위는 "") 바로 아래의 폴더와 파일. 정리 상자 속 파일은 빼요. 폴더는 큰 것부터, 파일은 최근 것부터예요.
export function listAt(things: Thing[], dir: string): { folders: FolderEntry[]; files: Thing[] } {
  const prefix = dir ? `${dir}/` : "";
  const folders = new Map<string, FolderEntry>();
  const files: Thing[] = [];
  for (const thing of things) {
    if (thing.box || !thing.path.startsWith(prefix)) continue;
    const rest = thing.path.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash < 0) {
      files.push(thing);
      continue;
    }
    const name = rest.slice(0, slash);
    const path = prefix + name;
    const entry = folders.get(path) ?? { path, name, things: [], size: 0 };
    entry.things.push(thing);
    entry.size += thing.size;
    folders.set(path, entry);
  }
  return { folders: [...folders.values()].sort((a, b) => b.size - a.size), files: files.sort((a, b) => b.lastModified - a.lastModified) };
}

// 판 위 폴더 하나의 안(그 아래 모든 파일). 상자 속 파일은 빼요.
export const folderThings = (things: Thing[], path: string) => things.filter((thing) => !thing.box && thing.path.startsWith(`${path}/`));
