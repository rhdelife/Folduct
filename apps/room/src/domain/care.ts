import type { CareSettings, Room, ScannedFile, Thing } from "./model";
import { newId } from "./model";

// 방 돌보기 규칙. 화면·저장소와 무관한 순수 함수만 둡니다.
export const boxFolderName = "_Folduct 정리상자";
export const sweepIntervalDays = 7;
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

// 최근 7일 안의 시각인지. 화면의 now가 방금 찍힌 파일보다 뒤처질 수 있어 하루는 봐주고, 그보다 먼 미래는 치지 않습니다.
export const withinWeek = (at: number, now: number) => at > 0 && at <= now + dayMs && now - at <= 7 * dayMs;

// 달력 날짜로 셉니다. 어젯밤에 쓴 파일은 오늘 새벽에도 '어제'예요.
export function relativeDay(at: number, now: number): string {
  const midnight = (time: number) => new Date(time).setHours(0, 0, 0, 0);
  const days = Math.round((midnight(now) - midnight(at)) / dayMs);
  return days <= 0 ? "오늘" : days === 1 ? "어제" : `${days}일 전`;
}

// shortcut: 기기 시계만 믿습니다. 시계가 뒤로 가면 판정이 늦어질 뿐이고, 옮기기 전에는 항상 사용자 확인을 거칩니다.
export function thingAge(thing: Thing, care: CareSettings, workDays: string[], now: number): { stale: boolean; days: number } {
  if (thing.touchedAt === null) return { stale: false, days: 0 };
  const last = lastActivity(thing);
  const days = Math.max(0, Math.floor((now - last) / dayMs));
  if (care.done || thing.pinned || thing.missing || thing.box) return { stale: false, days };
  // 방 자체를 쓰지 않은 기간은 방치가 아닙니다. 이 물건의 마지막 활동 날 뒤로 방을 쓴 날이 하루라도 있어야 합니다.
  const lastDay = localDay(last);
  const today = localDay(now);
  if (!workDays.some((day) => day > lastDay && day <= today)) return { stale: false, days };
  return { stale: days >= care.staleAfterDays, days };
}

// 큰 파일부터 보여 줍니다. 치웠을 때 공간이 가장 많이 비는 순서예요.
export function sweepCandidates(room: Room, now: number): Thing[] {
  if (room.care.done) return [];
  return room.things.filter((thing) => thing.spot && thingAge(thing, room.care, room.workDays, now).stale).sort((a, b) => b.size - a.size);
}

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

export function sweepDue(lastSweepAt: number | null, now: number): boolean {
  return lastSweepAt !== null && now - lastSweepAt >= sweepIntervalDays * dayMs;
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
  const used = new Set<string>();
  const seen = (thing: Thing, file: ScannedFile): Thing => ({ ...thing, name: file.name, kind: file.kind, size: file.size, lastModified: file.lastModified, lastUsedAt: Math.max(thing.lastUsedAt ?? 0, file.lastUsedAt ?? 0) || null, missing: false });
  const things = room.things.map((thing): Thing => {
    const entry = thing.box;
    // 옮기던 중 멈춘 물건은 두 자리 다 이 물건 몫으로 잡아 선반에 중복이 생기지 않게 합니다. 실제 위치는 reconcileBox가 맞춥니다.
    if (entry?.state === "moving-in" || entry?.state === "moving-out") {
      used.add(entry.fromPath);
      used.add(entry.boxPath);
      return byPath.has(entry.fromPath) || byPath.has(entry.boxPath) ? { ...thing, missing: false } : sure ? { ...thing, missing: true } : thing;
    }
    // Finder에서 상자 속 파일을 원래 자리로 직접 돌려놓았다면 상자 기록을 풉니다.
    if (entry?.state === "boxed" && !byPath.has(thing.path) && byPath.has(entry.fromPath)) {
      const back = byPath.get(entry.fromPath)!;
      used.add(back.path);
      return { ...seen(thing, back), path: back.path, box: null };
    }
    const found = byPath.get(thing.path);
    if (!found) return sure ? { ...thing, missing: true } : thing;
    used.add(found.path);
    return seen(thing, found);
  });
  for (const file of files) if (!used.has(file.path)) things.push(newThing(file));
  const before = roomUsage(room).totalBytes;
  const next = { ...room, things, workDays: mergeActivityDays(room.workDays, things, now), scan: { complete: scan.complete, failed: scan.failed, at: now, freedBytes: 0 } };
  next.scan.freedBytes = Math.max(0, before - roomUsage(next).totalBytes);
  return next;
}

// 고른 폴더가 이 방의 폴더가 맞는지: 지금 있는(없어지지도 상자에 들지도 않은) 물건 중 몇 개가 스캔에 보이는지.
export function scanOverlap(room: Room, files: ScannedFile[]): { kept: number; total: number } {
  const paths = new Set(files.map((file) => file.path));
  const present = room.things.filter((thing) => !thing.missing && !thing.box);
  return { kept: present.filter((thing) => paths.has(thing.path)).length, total: present.length };
}

export function newThing(file: ScannedFile): Thing {
  return { id: newId(), path: file.path, name: file.name, kind: file.kind, size: file.size, lastModified: file.lastModified, lastUsedAt: file.lastUsedAt ?? null, missing: false, spot: null, note: "", touchedAt: null, pinned: false, box: null };
}
