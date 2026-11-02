import type { NotebookSections, FileRef } from "./home";
import type { Room } from "./model";

// 손댈 것 종이가 쓰는 순수 계산: 방별로 무엇을 몇 줄 적을지, 언제 나타날지.

export type TaskRow = { type: "room"; key: string; room: Room; over: number | null } | { type: "file"; key: string; file: FileRef };
export type TaskRows = { rows: TaskRow[]; more: number; moreFiles: number };

// 방마다 머리 한 줄과 그 방의 오래된 파일. 한도 넘은 방, 오래된 파일이 있는 방 순서이고, 칸이 모자라면 방마다 한 줄씩 돌아가며 채웁니다.
export function taskRows(first: NotebookSections["first"], max: number): TaskRows {
  const over = new Map(first.overBudget.map(({ room, usage, budgetBytes }) => [room.id, { room, over: usage.totalBytes - budgetBytes }]));
  const worst = (files: FileRef[]) => Math.max(0, ...files.map((file) => file.days ?? 0));
  const groups = [
    ...first.stale.map(({ room, files }) => ({ room, over: over.get(room.id)?.over ?? null, files })),
    ...first.overBudget.filter(({ room }) => !first.stale.some((item) => item.room.id === room.id)).map(({ room }) => ({ room, over: over.get(room.id)!.over, files: [] as FileRef[] })),
  ].sort((a, b) => (b.over ?? -1) - (a.over ?? -1) || worst(b.files) - worst(a.files));

  let left = max;
  const shown = groups.filter((group) => {
    const needs = group.over === null ? 2 : 1;
    if (left < needs) return false;
    left -= needs;
    return true;
  });
  // 파일 때문에 적는 방은 첫 파일까지 자리를 잡아 둡니다.
  const taken: number[] = shown.map((group) => (group.over === null ? 1 : 0));
  for (let moved = true; moved && left > 0; ) {
    moved = false;
    shown.forEach((group, at) => {
      if (left > 0 && taken[at] < group.files.length) {
        taken[at] += 1;
        left -= 1;
        moved = true;
      }
    });
  }
  const rows = shown.flatMap((group, at): TaskRow[] => [
    { type: "room", key: `room-${group.room.id}`, room: group.room, over: group.over },
    ...group.files.slice(0, taken[at]).map((file): TaskRow => ({ type: "file", key: `file-${file.thing.id}`, file })),
  ]);
  const totalFiles = groups.reduce((sum, group) => sum + group.files.length, 0);
  const moreFiles = totalFiles - taken.reduce((sum, count) => sum + count, 0);
  return { rows, more: moreFiles + first.overBudget.length - shown.filter((group) => group.over !== null).length, moreFiles };
}

// 줄은 pos 1074에서 1194 사이에 차례로 나타납니다. 창끼리 겹쳐 물결처럼 이어지고(폭은 간격의 2.57배), 줄이 적으면 한 줄이 너무 늘어지지 않게 막아요.
export function rowWindow(index: number, count: number): { from: number; to: number } {
  const step = 120 / (count - 1 + 2.57);
  const from = 1074 + index * step;
  return { from, to: from + Math.min(step * 2.57, 60) };
}

// 종이에 들어가는 만큼만 적습니다. 넘치면 한 단씩 줄여요.
export const fitLadder: number[] = [10, 9, 8, 7, 6, 5, 4, 3, 2];
