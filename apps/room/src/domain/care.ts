import type { CareSettings, Room, ScannedFile, Thing } from "./model";
import { newId } from "./model";
import { isBackFolder } from "./pile";

// 방 돌보기 규칙. 화면·저장소와 무관한 순수 함수만 둡니다.
export const boxFolderName = "_Folduct 정리상자";
// Review(옛 이름 주간 정리)가 뜨는 주기. 환경설정에서 고르고, 고른 적이 없으면 7일이에요(2026-11-18 요청).
export const sweepIntervalDays = 7;
export const reviewChoices = [3, 7, 14, 30] as const;
export const reviewDays = (value: unknown): number => (reviewChoices as readonly unknown[]).includes(value) ? (value as number) : sweepIntervalDays;
export const dayMs = 24 * 60 * 60 * 1000;
export const defaultCare: CareSettings = { done: false, staleAfterDays: 30 };
// 방 전체를 이만큼 안 쓰면 홈에서 뺄지 묻습니다.
export const doneAfterDays = 60;

// 옛 기록은 기울어짐·쓰러짐 일수를 따로 가졌습니다. 예전 기본값 7일은 새 기본값으로 올리고, 직접 정한 쓰러짐 일수는 지킵니다.
// 없어진 잠시 쉼과 정리 제안 끄기는 버립니다. 그런 방은 진행 중으로 돌아와요.
export function normalizeCare(care: Partial<CareSettings> & { fallAfterDays?: unknown } | undefined): CareSettings {
  const { done, staleAfterDays } = { ...defaultCare, ...care };
  const old = care?.fallAfterDays;
  const kept = care?.staleAfterDays === undefined && typeof old === "number" && old > 0 && old !== 7 ? old : staleAfterDays;
  return { done, staleAfterDays: kept };
}

export function localDay(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// 손댄 날을 남깁니다. 오래된 날은 60개까지만 둡니다.
export function markWorkDay(workDays: string[], now: number): string[] {
  const today = localDay(now);
  return workDays.includes(today) ? workDays : [...workDays, today].sort().slice(-60);
}

// 스캔에서 본 '방 밖 작업' 날도 방을 쓴 날로 칩니다. 최근 60일 안, 미래가 아닌 날만요.
export function mergeActivityDays(workDays: string[], things: Pick<Thing, "lastModified" | "lastUsedAt">[], now: number): string[] {
  const days = new Set(workDays);
  for (const thing of things) {
    for (const at of [thing.lastModified, thing.lastUsedAt ?? 0]) if (at >= now - 60 * dayMs && at <= now) days.add(localDay(at));
  }
  return [...days].sort().slice(-60);
}

// 방 안에서 손댄 때, 고친 때, 방 밖에서 연 때 중 가장 늦은 시각.
export function lastActivity(thing: Pick<Thing, "touchedAt" | "lastModified" | "lastUsedAt">): number {
  return Math.max(thing.touchedAt ?? 0, thing.lastModified, thing.lastUsedAt ?? 0);
}

// 화면에 적는 손댄 때. 방을 만들 때 최근 파일에 넣은 손댄 때(= 방 만든 시각)는 사람이 손댄 게 아니라 빼요. 정리 판정은 lastActivity 그대로예요.
export const handTouchedAt = (thing: Pick<Thing, "touchedAt">, room: Pick<Room, "createdAt">): number | null => (thing.touchedAt === room.createdAt ? null : thing.touchedAt);
export const shownActivity = (thing: Pick<Thing, "touchedAt" | "lastModified" | "lastUsedAt">, room: Pick<Room, "createdAt">): number => lastActivity({ ...thing, touchedAt: handTouchedAt(thing, room) });

// 최근 7일 안의 시각인지. 화면의 now가 방금 찍힌 파일보다 뒤처질 수 있어 하루는 봐주고, 그보다 먼 미래는 치지 않습니다.
export const withinWeek = (at: number, now: number) => at > 0 && at <= now + dayMs && now - at <= 7 * dayMs;

// 달력 날짜로 셉니다. 어젯밤에 쓴 파일은 오늘 새벽에도 '어제'예요.
export function relativeDay(at: number, now: number): string {
  const midnight = (time: number) => new Date(time).setHours(0, 0, 0, 0);
  const days = Math.round((midnight(now) - midnight(at)) / dayMs);
  return days <= 0 ? "오늘" : days === 1 ? "어제" : `${days}일 전`;
}

// shortcut: 기기 시계만 믿습니다. 시계가 뒤로 가면 판정이 늦어질 뿐이고, 옮기기 전에는 항상 사용자 확인을 거칩니다.
// 주간 정리 후보는 방 안 '잠잠해요' 줄과 같은 날짜(실제 활동)로 정해요. 처음 본 날부터 세면 새 방은 30일 동안 아무것도 없다가 한꺼번에 몰려왔어요.
export function thingAge(thing: Thing, room: Pick<Room, "care" | "workDays" | "createdAt">, now: number): { stale: boolean; days: number } {
  const days = activityDays(thing, now);
  if (laneOf(thing, room, now) !== "quiet") return { stale: false, days };
  // 방 자체를 쓰지 않은 기간은 방치가 아닙니다. 이 물건의 마지막 활동 날 뒤로 방을 쓴 날이 하루라도 있어야 해요. 그런 방은 방 하나로 물어요(doneOfferDue).
  const lastDay = localDay(lastActivity(thing));
  const today = localDay(now);
  return { stale: room.workDays.some((day) => day > lastDay && day <= today), days };
}

// 큰 파일부터 보여 줍니다. 치웠을 때 공간이 가장 많이 비는 순서예요.
// 도구가 만든 폴더(target·build·cache…)와 사람이 치워 둔 보관 폴더(_archive·old·backup…) 안 파일은 이미 정리된 것이라 묻지 않아요(2026-11-19 요청).
const inBackFolder = (path: string) => path.split("/").slice(0, -1).some(isBackFolder);
// 내가 연결한 방은 방을 만든 뒤 새로 들어온 파일만 물어요(2026-11-20 요청). 방을 만들 때 이미 있던 파일은 그 방의 원래 모습이라 묻지 않아요.
// 샘플 방은 정리를 구경할 수 있게 그대로예요.
const addedLater = (thing: Thing, room: Room) => room.source === "sample" || thing.seenAt > room.createdAt;
export function sweepCandidates(room: Room, now: number): Thing[] {
  return room.things.filter((thing) => addedLater(thing, room) && !inBackFolder(thing.path) && thingAge(thing, room, now).stale).sort((a, b) => b.size - a.size);
}

// 주간 정리에서 살펴볼 방: 내가 추가한 방이 하나라도 있으면 그 방들만, 샘플 방만 있으면(웹 구경) 샘플 방이에요(2026-11-20 요청).
export function sweepRooms<T extends Pick<Room, "source">>(rooms: T[]): T[] {
  const mine = rooms.filter((room) => room.source !== "sample");
  return mine.length > 0 ? mine : rooms;
}

// 방 안 네 줄. 파일은 새로 왔어요 → 요즘 써요 → 잠잠해요 → 정리 상자로 흘러갑니다.
export type Lane = "new" | "use" | "quiet" | "box";
export const lanes: Lane[] = ["new", "use", "quiet", "box"];

// 실제 활동(방 안에서 손댄 때·고친 때·방 밖에서 연 때)에서 지난 날수. Folduct가 처음 본 날은 넣지 않아요.
export const activityDays = (thing: Pick<Thing, "touchedAt" | "lastModified" | "lastUsedAt">, now: number): number => Math.max(0, Math.floor((now - lastActivity(thing)) / dayMs));

// 새 파일: 방을 만든 뒤에 들어와 아직 방에서 열지 않은, 들어온 지 7일 안의 파일.
// 잠잠: 실제 활동이 '오래됨 기준'(기본 30일)보다 오래된 파일. 화면은 파일 날짜대로 정직하게 나눠요.
// 주간 정리 후보(thingAge)도 이 줄을 따라요. 한꺼번에 많아도 정리 창은 큰 파일 몇 개만 골라 둬요.
export function laneOf(thing: Thing, room: Pick<Room, "care" | "workDays" | "createdAt">, now: number): Lane {
  if (thing.box) return "box";
  if (thing.touchedAt === null && thing.seenAt > room.createdAt && withinWeek(thing.seenAt, now)) return "new";
  if (room.care.done || thing.pinned || thing.missing) return "use";
  return activityDays(thing, now) >= room.care.staleAfterDays ? "quiet" : "use";
}

// 줄 안 순서: 새로 왔어요는 최근에 들어온 것, 요즘 써요는 최근에 쓴 것, 잠잠해요는 가장 오래 쉰 것, 상자는 최근에 넣은 것부터.
export const laneOrder: Record<Lane, (a: Thing, b: Thing) => number> = {
  new: (a, b) => b.seenAt - a.seenAt,
  // 방을 만들 때 손댄 것으로 친 파일들은 손댄 때가 같아, 고치거나 쓴 날로 이어서 줄 세워요(화면 날짜와 같은 순서).
  use: (a, b) => lastActivity(b) - lastActivity(a) || lastActivity({ ...b, touchedAt: null }) - lastActivity({ ...a, touchedAt: null }),
  quiet: (a, b) => lastActivity(a) - lastActivity(b),
  box: (a, b) => (b.box?.at ?? 0) - (a.box?.at ?? 0),
};

// 있는 파일 중 마지막 활동. 파일이 없거나 활동을 모르면 0입니다.
export function roomLastActivity(room: Pick<Room, "things">): number {
  return room.things.filter((thing) => !thing.missing && !thing.box).reduce((latest, thing) => Math.max(latest, lastActivity(thing)), 0);
}

// 방을 통째로 안 쓴 기간은 파일 판정에서 빠지니, 그런 방은 파일 대신 방 하나로 묻습니다. 답한 뒤로 다시 쓰기 전까지는 묻지 않아요.
export function doneOfferDue(room: Room, now: number): boolean {
  if (room.care.done) return false;
  const last = roomLastActivity(room);
  return last > 0 && now - last > doneAfterDays * dayMs && (room.doneOfferAt === null || last > room.doneOfferAt);
}

export function sweepDue(lastSweepAt: number | null, now: number, days: number = sweepIntervalDays): boolean {
  return lastSweepAt !== null && now - lastSweepAt >= days * dayMs;
}

export function firstLine(text: string): string {
  return text.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

export function isInBox(path: string): boolean {
  return path === boxFolderName || path.startsWith(`${boxFolderName}/`);
}

// 원래 하위 경로를 상자 안에서도 유지합니다. 이름이 겹치면 "이름 (2).확장자"로 피합니다.
export function boxPathCandidate(fromPath: string, attempt: number): string {
  const parts = fromPath.split("/");
  const name = parts.pop() ?? fromPath;
  return [boxFolderName, ...parts, numberedName(name, attempt)].join("/");
}

export function numberedName(name: string, attempt: number): string {
  if (attempt <= 1) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  return `${base} (${attempt})${ext}`;
}

// ── 물건 크기 (FR16): 파일이 클수록 아이콘이 커집니다. ──
// 로그 눈금이라 4GB 영상 하나가 나머지를 가리지 않고, KB 단위 코드 파일끼리도 크기 차이가 보입니다.
export const GB = 1024 ** 3;

// 1KB 이하 0, 1MB 0.5, 1GB 이상 1.
export function sizeRatio(bytes: number): number {
  if (!(bytes > 1024)) return 0;
  return Math.min(1, Math.log2(bytes / 1024) / 20);
}

// 1KB 0.7배 · 1MB 1.35배 · 1GB 이상 2배.
export function objectScale(bytes: number): number {
  return 0.7 + 1.3 * sizeRatio(bytes);
}

// ── 방 용량 ──
export type RoomUsage = { totalBytes: number; boxBytes: number; exact: boolean };

// 스캔으로 확인한 파일만 한 번씩 셉니다. 상자 안 파일도 아직 폴더에 있으니 합계에 넣고 따로 보여줍니다.
export function roomUsage(room: Pick<Room, "things" | "scan">): RoomUsage {
  const seen = new Set<string>();
  let totalBytes = 0;
  let boxBytes = 0;
  for (const thing of room.things) {
    if (thing.missing || seen.has(thing.path)) continue;
    seen.add(thing.path);
    totalBytes += thing.size;
    if (thing.box || isInBox(thing.path)) boxBytes += thing.size;
  }
  return { totalBytes, boxBytes, exact: room.scan.complete && room.scan.failed === 0 };
}

// ── 다시 보기: 스캔 결과를 방에 합칩니다. 메모와 자리는 지우지 않습니다. ──
// 부분 스캔(파일 수·깊이 제한, 읽기 실패)에서 못 본 파일은 없어진 게 아니라 못 본 것이라 '파일 없음'으로 바꾸지 않습니다.
export function mergeScan(room: Room, files: ScannedFile[], scan: { complete: boolean; failed: number }, now: number): Room {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const sure = scan.complete && scan.failed === 0;
  const moved = movedFiles(room, files, scan);
  const used = new Set<string>();
  const seen = (thing: Thing, file: ScannedFile): Thing => ({ ...thing, path: file.path, name: file.name, kind: file.kind, size: file.size, lastModified: file.lastModified, lastUsedAt: Math.max(thing.lastUsedAt ?? 0, file.lastUsedAt ?? 0) || null, missing: false, box: thing.box ?? foundInBox(file.path, now) });
  const things = room.things.map((thing): Thing | null => {
    const entry = thing.box;
    // 옮기던 중 멈춘 물건은 두 자리 다 이 물건 몫으로 잡아 같은 파일이 두 번 생기지 않게 합니다. 실제 위치는 reconcileBox가 맞춥니다.
    if (entry?.state === "moving-in" || entry?.state === "moving-out") {
      used.add(entry.fromPath);
      used.add(entry.boxPath);
      return byPath.has(entry.fromPath) || byPath.has(entry.boxPath) ? { ...thing, missing: false } : sure ? { ...thing, missing: true } : thing;
    }
    // Finder에서 상자 속 파일을 원래 자리로 직접 돌려놓았다면 상자 기록을 풉니다.
    if (entry?.state === "boxed" && !byPath.has(thing.path) && byPath.has(entry.fromPath)) {
      const back = byPath.get(entry.fromPath)!;
      used.add(back.path);
      return { ...seen(thing, back), box: null };
    }
    const found = byPath.get(thing.path) ?? moved.get(thing.id);
    // 상자에 든 파일을 Finder에서 비웠다면 상자 기록도 뺍니다. 상자는 지울 것을 모아 두는 곳이라 남겨 둘 이유가 없어요.
    if (!found && sure && entry) return null;
    if (!found) return sure ? { ...thing, missing: true } : thing;
    used.add(found.path);
    return seen(thing, found);
  });
  const kept = things.filter((thing) => thing !== null);
  for (const file of files) if (!used.has(file.path)) kept.push({ ...newThing(file, now), ...(lateFind(room, file, scan) ? { seenAt: room.createdAt } : {}), box: foundInBox(file.path, now) });
  const before = roomUsage(room).totalBytes;
  const next = { ...room, things: kept, workDays: mergeActivityDays(room.workDays, kept, now), scan: { complete: scan.complete, failed: scan.failed, at: now, freedBytes: 0 } };
  next.scan.freedBytes = Math.max(0, before - roomUsage(next).totalBytes);
  return next;
}

// 상자 폴더 안에서 처음 보는 파일은 상자에 든 파일로 칩니다(사용자가 직접 넣었거나 옛 기록이 사라진 경우). 원래 자리는 상자 밖 같은 경로예요.
function foundInBox(path: string, now: number): Thing["box"] {
  return isInBox(path) && path !== boxFolderName ? { state: "boxed", fromPath: path.slice(boxFolderName.length + 1), boxPath: path, at: now } : null;
}

// 고른 폴더가 이 방의 폴더가 맞는지: 지금 있는(없어지지도 상자에 들지도 않은) 물건 중 몇 개가 스캔에 보이는지.
export function scanOverlap(room: Room, files: ScannedFile[]): { kept: number; total: number } {
  const paths = new Set(files.map((file) => file.path));
  const present = room.things.filter((thing) => !thing.missing && !thing.box);
  return { kept: present.filter((thing) => paths.has(thing.path)).length, total: present.length };
}

// 상자로 옮긴 파일은 원래 자리와 상자 자리 모두 아는 파일로 칩니다.
const knownPaths = (room: Room) => new Set(room.things.flatMap((thing) => [thing.path, ...(thing.box ? [thing.box.fromPath, thing.box.boxPath] : [])]));

// 밖에서 이름을 바꾸거나 옮긴 파일 찾기. 빠짐없이 읽은 스캔에서, 이번에 사라진 물건과 새 파일이 크기·고친 시각으로 일대일일 때만 같은 파일로 봅니다.
// 겹치면 고르지 않아요. 상자 기록이 있는 물건과 상자 폴더의 파일은 잇지 않습니다. 틀려도 기록만 바뀌고 파일은 옮기지 않아요.
function movedFiles(room: Room, files: ScannedFile[], scan: { complete: boolean; failed: number }): Map<string, ScannedFile> {
  const moved = new Map<string, ScannedFile>();
  if (!scan.complete || scan.failed > 0) return moved;
  const paths = new Set(files.map((file) => file.path));
  const known = knownPaths(room);
  // 빈 파일과 시각을 모르는 파일은 근거가 없습니다.
  const hasEvidence = (item: Pick<Thing, "size" | "lastModified">) => item.size > 0 && item.lastModified > 0;
  const same = (a: Pick<Thing, "size" | "lastModified">, b: Pick<Thing, "size" | "lastModified">) => a.size === b.size && a.lastModified === b.lastModified;
  const gone = room.things.filter((thing) => !thing.box && !thing.missing && hasEvidence(thing) && !paths.has(thing.path));
  const fresh = files.filter((file) => hasEvidence(file) && !known.has(file.path) && !isInBox(file.path));
  for (const thing of gone) {
    const found = fresh.filter((file) => same(file, thing));
    if (found.length === 1 && gone.filter((other) => same(other, thing)).length === 1) moved.set(thing.id, found[0]);
  }
  return moved;
}

// 이 방이 아직 모르는 파일의 수. 이름만 바뀐 파일은 새 파일이 아닙니다.
export function newFileCount(room: Room, files: ScannedFile[], scan: { complete: boolean; failed: number }): number {
  const known = knownPaths(room);
  const moved = new Set([...movedFiles(room, files, scan).values()].map((file) => file.path));
  return files.filter((file) => !known.has(file.path) && !moved.has(file.path) && !isInBox(file.path) && !lateFind(room, file, scan)).length;
}

// 다 읽지 못한 큰 방에서, 방을 만들기 전부터 있던 파일이 이제야 읽힌 경우. 새로 들어온 게 아니니 '새로 왔어요'와 새 파일 알림에서 빼요.
// (읽는 순서가 바뀌거나 한도 안쪽이 달라지면 생겨요.) 큰 방에 오래된 날짜로 옮겨 넣은 파일도 같이 빠지는 건 감수해요.
function lateFind(room: Room, file: ScannedFile, scan: { complete: boolean }): boolean {
  return !scan.complete && file.lastModified > 0 && file.lastModified < room.createdAt;
}

export function newThing(file: ScannedFile, now: number): Thing {
  return { id: newId(), path: file.path, name: file.name, kind: file.kind, size: file.size, lastModified: file.lastModified, lastUsedAt: file.lastUsedAt ?? null, missing: false, spot: null, note: "", touchedAt: null, seenAt: now, pinned: false, box: null };
}
