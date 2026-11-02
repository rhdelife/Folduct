import { boxColor, colorGroups } from "../art/palette";
import { budgetLevel, dayMs, lastActivity, roomUsage, sweepDue, thingStage, withinWeek, type RoomUsage, type Stage } from "./care";
import { formatBytes, kindLabels, type Kind, type Room, type Thing } from "./model";

// 집 화면 장면들이 보여 줄 내용을 고릅니다. 화면과 무관한 순수 함수만 둡니다.

// days는 마지막 활동 뒤로 지난 날수, 활동을 모르면 null입니다.
export type FileRef = { room: Room; thing: Thing; stage: Stage; days: number | null };

function fileRef(room: Room, thing: Thing, now: number): FileRef {
  const last = lastActivity(thing);
  return { room, thing, stage: thingStage(thing, room.care, room.workDays, now).stage, days: last > 0 ? Math.max(0, Math.floor((now - last) / dayMs)) : null };
}

// 상자 안이나 사라진 파일을 뺀, 폴더 자리에 있는 파일.
const present = (room: Room) => room.things.filter((thing) => !thing.missing && !thing.box);
const usedRecently = (thing: Thing, now: number) => withinWeek(lastActivity(thing), now);
// 기울고 쓰러지는 건 바닥에 놓은 파일뿐입니다(지도의 roomMess와 같은 기준).
const placedRefs = (rooms: Room[], now: number, stage: Stage) => rooms.flatMap((room) => present(room).filter((thing) => thing.spot).map((thing) => fileRef(room, thing, now)).filter((file) => file.stage === stage));
const byDaysDesc = (a: FileRef, b: FileRef) => (b.days ?? 0) - (a.days ?? 0);

export type NotebookSections = {
  first: { fallen: { room: Room; files: FileRef[] }[]; overBudget: { room: Room; usage: RoomUsage; budgetBytes: number }[]; sweepOverdue: boolean };
  info: { tilted: FileRef[]; recent: { label: string; color: string; kinds: Kind[]; count: number }[] };
  later: { doneRooms: number; shelfFiles: number };
};

// 손댈 것: 먼저(쓰러진 파일, 한도 넘은 방, 밀린 정리), 참고(기울어진 파일, 최근 7일에 쓴 형식), 나중에(완료한 방, 선반 위 파일).
export function notebookSections(rooms: Room[], now: number, lastSweepAt: number | null = null): NotebookSections {
  const active = rooms.filter((room) => !room.care.done);
  const fallen = active.map((room) => ({ room, files: placedRefs([room], now, "fallen").sort(byDaysDesc) })).filter((item) => item.files.length > 0);
  const overBudget = active.flatMap((room) => {
    const usage = roomUsage(room);
    return room.budgetBytes !== null && budgetLevel(usage, room.budgetBytes) === "over" ? [{ room, usage, budgetBytes: room.budgetBytes }] : [];
  });
  const recent = colorGroups
    .map(({ label, color, kinds }) => ({
      label,
      color,
      kinds,
      count: active.reduce((sum, room) => sum + present(room).filter((thing) => kinds.includes(thing.kind) && usedRecently(thing, now)).length, 0),
    }))
    .filter((group) => group.count > 0);
  return {
    first: { fallen, overBudget, sweepOverdue: sweepDue(lastSweepAt, now) && fallen.length > 0 },
    info: { tilted: placedRefs(active, now, "tilted").sort(byDaysDesc), recent },
    later: { doneRooms: rooms.length - active.length, shelfFiles: active.reduce((sum, room) => sum + present(room).filter((thing) => !thing.spot).length, 0) },
  };
}

export type StatusTone = "ok" | "tilted" | "fallen" | "shelf" | "box";
export type TableRow = { thing: Thing; name: string; path: string; size: number; kind: Kind; kindLabel: string; status: string; tone: StatusTone };

// 방 한 장의 표. 큰 파일부터, 패널 목록과 같은 상태 말로 적습니다.
export function tableRows(room: Room, now: number): TableRow[] {
  return room.things
    .filter((thing) => !thing.missing)
    .map((thing) => {
      const { stage, days } = thingStage(thing, room.care, room.workDays, now);
      const [status, tone]: [string, StatusTone] = thing.box ? ["정리 상자", "box"] : !thing.spot ? ["선반", "shelf"] : stage === "fallen" ? [`${days}일째 · 쓰러짐`, "fallen"] : stage === "tilted" ? [`${days}일째 · 기울어짐`, "tilted"] : ["제자리", "ok"];
      return { thing, name: thing.name, path: thing.path, size: thing.size, kind: thing.kind, kindLabel: kindLabels[thing.kind], status, tone };
    })
    .sort((a, b) => b.size - a.size);
}

const refsOf = (rooms: Room[], now: number, keep: (thing: Thing) => boolean) => rooms.flatMap((room) => present(room).filter(keep).map((thing) => fileRef(room, thing, now)));

// 이번 주 쓴 파일. 최근 것부터.
export const recentFiles = (rooms: Room[], now: number): FileRef[] => refsOf(rooms, now, (thing) => usedRecently(thing, now)).sort((a, b) => lastActivity(b.thing) - lastActivity(a.thing));

// 선반 위 파일. 큰 것부터.
export const shelfFiles = (rooms: Room[], now: number): FileRef[] => refsOf(rooms, now, (thing) => !thing.spot).sort((a, b) => b.thing.size - a.thing.size);

export type DialRoom = { room: Room; done: boolean; files: number; bytes: number };

// 방 모음: 진행 중인 방 뒤에 완료한 방까지 모두.
export function dialRooms(rooms: Room[]): DialRoom[] {
  const entry = (room: Room): DialRoom => ({ room, done: room.care.done, files: present(room).length, bytes: roomUsage(room).totalBytes });
  return [...rooms.filter((room) => !room.care.done), ...rooms.filter((room) => room.care.done)].map(entry);
}

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

// 머리글의 숫자. 장면 순서대로 내 방, 손댈 것, 방, 방 모음, 형식별입니다. 소개 문장 대신 지금 내 상태를 적어요.
export function captionWords(rooms: Room[], now: number): string[] {
  const active = rooms.filter((room) => !room.care.done);
  const { first } = notebookSections(rooms, now);
  const fallen = first.fallen.reduce((sum, item) => sum + item.files.length, 0);
  const urgent = [fallen > 0 && `쓰러진 파일 ${fallen}개`, first.overBudget.length > 0 && `한도 넘은 방 ${first.overBudget.length}개`].filter(Boolean);
  // 표 장면에는 완료한 방의 탭도 있어서, 방과 파일은 완료까지 함께 셉니다.
  const files = rooms.reduce((sum, room) => sum + present(room).length, 0);
  const done = rooms.length - active.length;
  const kinds = kindGroups(rooms, now, 0).filter((group) => !group.box);
  return [
    `${active.length}개 · ${formatBytes(active.reduce((sum, room) => sum + roomUsage(room).totalBytes, 0))}`,
    urgent.join(" · ") || "급한 건 없어요",
    `${rooms.length}개 · 파일 ${files}개`,
    done > 0 ? `진행 중 ${active.length}개 · 완료 ${done}개` : `진행 중 ${active.length}개`,
    `파일 ${kinds.reduce((sum, group) => sum + group.count, 0)}개 · ${formatBytes(kinds.reduce((sum, group) => sum + group.bytes, 0))}`,
  ];
}
