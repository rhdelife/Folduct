import { dayMs, defaultCare, doneAfterDays, mergeActivityDays, newThing } from "./care";
import { pickFace } from "./face";
import { freeSpot } from "./plane";
import { isSafeRelativePath, kindOf, newId, type Room, type RoomFace, type RoomSource, type ScannedFile } from "./model";

// 이만큼 아무 파일도 쓰거나 고치지 않은 폴더는 가져올 때 홈에서 빼 둡니다. 방 설정에서 언제든 바꿀 수 있어요.
export { doneAfterDays };

export type ImportedRoom = { name: string; origin: string; complete: boolean; failed: number; files: ScannedFile[] };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

// 디스크에서 고른 파일이라 칸 하나하나를 확인합니다. 모양이 틀린 항목은 빼고 센다.
export function parseRoomsFile(text: string): { rooms: ImportedRoom[]; skipped: number } | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(data) || data.kind !== "folduct-rooms" || data.version !== 1 || !Array.isArray(data.rooms)) return null;
  const rooms: ImportedRoom[] = [];
  let skipped = 0;
  for (const raw of data.rooms.slice(0, 200)) {
    if (!isObject(raw) || typeof raw.name !== "string" || !raw.name.trim() || typeof raw.origin !== "string" || !Array.isArray(raw.files)) {
      skipped += 1;
      continue;
    }
    const files: ScannedFile[] = [];
    for (const file of raw.files.slice(0, 1000)) {
      if (isObject(file) && typeof file.path === "string" && isSafeRelativePath(file.path) && isCount(file.size) && isCount(file.lastModified)) {
        // 이름과 종류는 경로의 마지막 칸에서만 정합니다. 따로 적힌 name을 믿으면 index.html이 그림으로 열릴 수 있어요.
        const name = file.path.split("/").pop()!;
        files.push({ path: file.path, name, kind: kindOf(name), size: file.size, lastModified: file.lastModified, lastUsedAt: isCount(file.lastUsedAt) ? file.lastUsedAt : null });
      } else {
        skipped += 1;
      }
    }
    rooms.push({
      name: raw.name.trim().slice(0, 40),
      origin: raw.origin.slice(0, 1024),
      // 빠진 항목이 있으면 부분 목록으로 봅니다.
      complete: raw.complete === true && files.length === raw.files.length,
      failed: Number.isInteger(raw.failed) && (raw.failed as number) >= 0 ? (raw.failed as number) : 0,
      files,
    });
  }
  return { rooms, skipped };
}

export function looksDone(files: ScannedFile[], now: number): boolean {
  const newest = files.reduce((latest, file) => Math.max(latest, file.lastModified, file.lastUsedAt ?? 0), 0);
  return now - newest > doneAfterDays * dayMs;
}

// 빈 바닥보다는 최근에 고친 물건 몇 개를 먼저 들여놓습니다. 나머지는 선반에서 꺼내 놓으면 돼요.
export function buildRoom(input: {
  name: string;
  source: RoomSource;
  rootName: string;
  origin?: string;
  files: ScannedFile[];
  scan: { complete: boolean; failed: number };
  done: boolean;
  workDays: string[];
  now: number;
  // 이미 있는 방의 얼굴. 되도록 겹치지 않게 고릅니다.
  taken?: RoomFace[];
}): Room {
  const things = input.files.map(newThing);
  for (const thing of [...things].sort((a, b) => b.lastModified - a.lastModified).slice(0, 6)) {
    thing.spot = freeSpot(things, things.indexOf(thing));
    thing.touchedAt = input.now;
  }
  const id = newId();
  return {
    id,
    name: input.name,
    createdAt: input.now,
    source: input.source,
    rootName: input.rootName,
    ...(input.origin ? { origin: input.origin } : {}),
    scan: { complete: input.scan.complete, failed: input.scan.failed, at: input.now, freedBytes: 0 },
    things,
    workDays: mergeActivityDays(input.workDays, things, input.now),
    care: { ...defaultCare, done: input.done },
    doneOfferAt: null,
    face: pickFace(input.taken ?? [], id),
  };
}
