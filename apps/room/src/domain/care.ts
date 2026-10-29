import type { CareSettings, Room, ScannedFile, Thing } from "./model";
import { newId } from "./model";

// 방 돌보기 규칙. 화면·저장소와 무관한 순수 함수만 둡니다.
export const boxFolderName = "_Folduct 정리상자";
export const sweepIntervalDays = 7;
export const dayMs = 24 * 60 * 60 * 1000;
export const defaultCare: CareSettings = { enabled: true, resting: false, done: false, tiltAfterDays: 3, fallAfterDays: 7 };

export type Stage = "normal" | "tilted" | "fallen";

export function localDay(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// 손댄 날을 남깁니다. 오래된 날은 60개까지만 둡니다.
export function markWorkDay(workDays: string[], now: number): string[] {
  const today = localDay(now);
  return workDays.includes(today) ? workDays : [...workDays, today].sort().slice(-60);
}

// shortcut: 기기 시계만 믿습니다. 시계가 뒤로 가면 판정이 늦어질 뿐이고, 옮기기 전에는 항상 사용자 확인을 거칩니다.
export function thingStage(thing: Thing, care: CareSettings, workDays: string[], now: number): { stage: Stage; days: number } {
  if (thing.touchedAt === null) return { stage: "normal", days: 0 };
  const days = Math.max(0, Math.floor((now - thing.touchedAt) / dayMs));
  if (!care.enabled || care.resting || care.done || thing.pinned || thing.missing || thing.box) return { stage: "normal", days };
  // 원본이 손댄 뒤에 수정됐다면 밖에서 작업 중일 수 있습니다.
  if (thing.lastModified > thing.touchedAt) return { stage: "normal", days };
  // 방 자체를 쓰지 않은 기간은 방치가 아닙니다. 손댄 날 뒤로 방을 쓴 날이 하루라도 있어야 합니다.
  const touchedDay = localDay(thing.touchedAt);
  const today = localDay(now);
  if (!workDays.some((day) => day > touchedDay && day <= today)) return { stage: "normal", days };
  if (days >= care.fallAfterDays) return { stage: "fallen", days };
  if (days >= care.tiltAfterDays) return { stage: "tilted", days };
  return { stage: "normal", days };
}

export function sweepCandidates(room: Room, now: number): Thing[] {
  if (!room.care.enabled || room.care.resting || room.care.done) return [];
  return room.things.filter((thing) => thing.spot && thingStage(thing, room.care, room.workDays, now).stage === "fallen");
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
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  return [boxFolderName, ...parts, attempt <= 1 ? name : `${base} (${attempt})${ext}`].join("/");
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

export type BudgetLevel = "unset" | "partial" | "ok" | "near" | "over";

// 부분 스캔은 실제보다 작게 보이므로 경고하지 않습니다.
export function budgetLevel(usage: RoomUsage, budgetBytes: number | null): BudgetLevel {
  if (!usage.exact) return "partial";
  if (budgetBytes === null) return "unset";
  const ratio = usage.totalBytes / budgetBytes;
  return ratio >= 1 ? "over" : ratio >= 0.8 ? "near" : "ok";
}

export function budgetNoticeDue(room: Room, now: number): boolean {
  return !room.care.done && budgetLevel(roomUsage(room), room.budgetBytes) === "over" && (room.budgetNoticeAt === null || now - room.budgetNoticeAt >= sweepIntervalDays * dayMs);
}

// 지금 용량 × 1.5를 GB 단위로 반올림합니다. 1GB 아래 방도 1GB부터 제안합니다.
export function suggestBudget(totalBytes: number): number {
  return Math.max(1, Math.round((totalBytes * 1.5) / GB)) * GB;
}

export const budgetPresets = [GB, 5 * GB, 20 * GB];

// ── 다시 보기: 스캔 결과를 방에 합칩니다. 메모와 자리는 지우지 않습니다. ──
// 부분 스캔(파일 수·깊이 제한, 읽기 실패)에서 못 본 파일은 없어진 게 아니라 못 본 것이라 '파일 없음'으로 바꾸지 않습니다.
export function mergeScan(room: Room, files: ScannedFile[], scan: { complete: boolean; failed: number }, now: number): Room {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const used = new Set<string>();
  const seen = (thing: Thing, file: ScannedFile): Thing => ({ ...thing, name: file.name, kind: file.kind, size: file.size, lastModified: file.lastModified, missing: false });
  const things = room.things.map((thing): Thing => {
    const entry = thing.box;
    // 옮기던 중 멈춘 물건은 두 자리 다 이 물건 몫으로 잡아 선반에 중복이 생기지 않게 합니다. 실제 위치는 reconcileBox가 맞춥니다.
    if (entry?.state === "moving-in" || entry?.state === "moving-out") {
      used.add(entry.fromPath);
      used.add(entry.boxPath);
      return byPath.has(entry.fromPath) || byPath.has(entry.boxPath) ? { ...thing, missing: false } : scan.complete ? { ...thing, missing: true } : thing;
    }
    // Finder에서 상자 속 파일을 원래 자리로 직접 돌려놓았다면 상자 기록을 풉니다.
    if (entry?.state === "boxed" && !byPath.has(thing.path) && byPath.has(entry.fromPath)) {
      const back = byPath.get(entry.fromPath)!;
      used.add(back.path);
      return { ...seen(thing, back), path: back.path, box: null };
    }
    const found = byPath.get(thing.path);
    if (!found) return scan.complete ? { ...thing, missing: true } : thing;
    used.add(found.path);
    return seen(thing, found);
  });
  for (const file of files) if (!used.has(file.path)) things.push(newThing(file));
  const before = roomUsage(room).totalBytes;
  const next = { ...room, things, scan: { complete: scan.complete, failed: scan.failed, at: now, freedBytes: 0 } };
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
  return { id: newId(), path: file.path, name: file.name, kind: file.kind, size: file.size, lastModified: file.lastModified, missing: false, spot: null, note: "", touchedAt: null, pinned: false, box: null };
}
