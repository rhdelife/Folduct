import { boxColor, colorGroups } from "../art/palette";
import { dayMs, doneOfferDue, lastActivity, roomUsage, sweepDue, thingAge, withinWeek } from "./care";
import { formatBytes, kindLabels, type Kind, type Room, type Thing } from "./model";

// 집 화면 장면들이 보여 줄 내용을 고릅니다. 화면과 무관한 순수 함수만 둡니다.

// days는 마지막 활동 뒤로 지난 날수, 활동을 모르면 null입니다.
export type FileRef = { room: Room; thing: Thing; stale: boolean; days: number | null };

function fileRef(room: Room, thing: Thing, now: number): FileRef {
  const last = lastActivity(thing);
  return { room, thing, stale: thingAge(thing, room.care, room.workDays, now).stale, days: last > 0 ? Math.max(0, Math.floor((now - last) / dayMs)) : null };
}

// 상자 안이나 사라진 파일을 뺀, 폴더 자리에 있는 파일.
const present = (room: Room) => room.things.filter((thing) => !thing.missing && !thing.box);
const usedRecently = (thing: Thing, now: number) => withinWeek(lastActivity(thing), now);
// 오래됨으로 치는 건 바닥에 놓은 파일뿐입니다(지도의 staleCount와 같은 기준).
const staleRefs = (room: Room, now: number) => present(room).filter((thing) => thing.spot).map((thing) => fileRef(room, thing, now)).filter((file) => file.stale);
const byDaysDesc = (a: FileRef, b: FileRef) => (b.days ?? 0) - (a.days ?? 0);

export type NotebookSections = {
  first: { stale: { room: Room; files: FileRef[] }[]; sweepOverdue: boolean };
  info: { recent: { label: string; color: string; kinds: Kind[]; count: number }[] };
  later: { doneRooms: number; shelfFiles: number };
};

// 주간 공책을 저절로 띄울 만한 일이 있는지. 손댈 게 없는 주에는 띄우지 않아요.
export function weeklyHasWork(rooms: Room[], now: number): boolean {
  const { first } = notebookSections(rooms, now);
  return first.stale.length > 0 || rooms.some((room) => doneOfferDue(room, now));
}

// 손댈 것: 먼저(오래된 파일, 밀린 정리), 참고(최근 7일에 쓴 형식), 나중에(완료한 방, 선반 위 파일).
export function notebookSections(rooms: Room[], now: number, lastSweepAt: number | null = null): NotebookSections {
  const active = rooms.filter((room) => !room.care.done);
  const stale = active.map((room) => ({ room, files: staleRefs(room, now).sort(byDaysDesc) })).filter((item) => item.files.length > 0);
  const recent = colorGroups
    .map(({ label, color, kinds }) => ({
      label,
      color,
      kinds,
      count: active.reduce((sum, room) => sum + present(room).filter((thing) => kinds.includes(thing.kind) && usedRecently(thing, now)).length, 0),
    }))
    .filter((group) => group.count > 0);
  return {
    first: { stale, sweepOverdue: sweepDue(lastSweepAt, now) && stale.length > 0 },
    info: { recent },
    later: { doneRooms: rooms.length - active.length, shelfFiles: active.reduce((sum, room) => sum + present(room).filter((thing) => !thing.spot).length, 0) },
  };
}

export type StatusTone = "ok" | "stale" | "shelf" | "box";
export type TableRow = { thing: Thing; name: string; path: string; size: number; kind: Kind; kindLabel: string; status: string; tone: StatusTone };

// 방 한 장의 표. 큰 파일부터, 패널 목록과 같은 상태 말로 적습니다.
export function tableRows(room: Room, now: number): TableRow[] {
  return room.things
    .filter((thing) => !thing.missing)
    .map((thing) => {
      const { stale, days } = thingAge(thing, room.care, room.workDays, now);
      const [status, tone]: [string, StatusTone] = thing.box ? ["정리 상자", "box"] : !thing.spot ? ["선반", "shelf"] : stale ? [`${days}일째 그대로`, "stale"] : ["제자리", "ok"];
      return { thing, name: thing.name, path: thing.path, size: thing.size, kind: thing.kind, kindLabel: kindLabels[thing.kind], status, tone };
    })
    .sort((a, b) => b.size - a.size);
}

const refsOf = (rooms: Room[], now: number, keep: (thing: Thing) => boolean) => rooms.flatMap((room) => present(room).filter(keep).map((thing) => fileRef(room, thing, now)));

// 이번 주 쓴 파일. 최근 것부터.
export const recentFiles = (rooms: Room[], now: number): FileRef[] => refsOf(rooms, now, (thing) => usedRecently(thing, now)).sort((a, b) => lastActivity(b.thing) - lastActivity(a.thing));

// 선반 위 파일. 큰 것부터.
export const shelfFiles = (rooms: Room[], now: number): FileRef[] => refsOf(rooms, now, (thing) => !thing.spot).sort((a, b) => b.thing.size - a.thing.size);

export type KindGroup = { label: string; color: string; kinds: Kind[]; box: boolean; count: number; bytes: number; top: FileRef[] };

// 형식별 묶음: colorGroups 하나에 하나씩, 맨 끝에 정리 상자. 비어 있어도 묶음은 있습니다.
export function kindGroups(rooms: Room[], now: number, topCount = 5): KindGroup[] {
  const files = rooms.flatMap((room) => room.things.filter((thing) => !thing.missing).map((thing) => fileRef(room, thing, now)));
  const collect = (label: string, color: string, kinds: Kind[], box: boolean): KindGroup => {
    const held = files.filter(({ thing }) => (box ? thing.box !== null : thing.box === null && kinds.includes(thing.kind))).sort((a, b) => b.thing.size - a.thing.size);
    return { label, color, kinds, box, count: held.length, bytes: held.reduce((sum, { thing }) => sum + thing.size, 0), top: held.slice(0, topCount) };
  };
  return [...colorGroups.map(({ label, color, kinds }) => collect(label, color, kinds, false)), collect("정리 상자", boxColor, [], true)];
}

// 머리글의 숫자. 장면 순서대로 내 방, 손댈 것, 형식별입니다. 소개 문장 대신 지금 내 상태를 적어요.
export function captionWords(rooms: Room[], now: number): string[] {
  const active = rooms.filter((room) => !room.care.done);
  const { first } = notebookSections(rooms, now);
  const stale = first.stale.reduce((sum, item) => sum + item.files.length, 0);
  const kinds = kindGroups(rooms, now, 0).filter((group) => !group.box);
  return [
    `${active.length}개 · ${formatBytes(active.reduce((sum, room) => sum + roomUsage(room).totalBytes, 0))}`,
    stale > 0 ? `오래된 파일 ${stale}개` : "급한 건 없어요",
    `파일 ${kinds.reduce((sum, group) => sum + group.count, 0)}개 · ${formatBytes(kinds.reduce((sum, group) => sum + group.bytes, 0))}`,
  ];
}
