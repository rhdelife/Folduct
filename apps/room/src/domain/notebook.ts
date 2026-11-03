import type { NotebookSections, FileRef } from "./home";
import type { Room } from "./model";

// 손댈 것 종이가 쓰는 순수 계산: 방별로 무엇을 몇 줄 적을지, 언제 나타날지.

export type TaskRow = { type: "room"; key: string; room: Room } | { type: "file"; key: string; file: FileRef };
export type TaskRows = { rows: TaskRow[]; more: number };

// 방마다 머리 한 줄과 그 방의 오래된 파일. 오래된 파일이 더 오래된 방부터 적고, 칸이 모자라면 방마다 한 줄씩 돌아가며 채웁니다.
export function taskRows(first: NotebookSections["first"], max: number): TaskRows {
  const worst = (files: FileRef[]) => Math.max(0, ...files.map((file) => file.days ?? 0));
  const groups = [...first.stale].sort((a, b) => worst(b.files) - worst(a.files));
  // 방은 첫 파일까지 두 줄을 잡아 둡니다.
  const shown = groups.slice(0, Math.floor(max / 2));
  let left = max - shown.length * 2;
  const taken: number[] = shown.map(() => 1);
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
    { type: "room", key: `room-${group.room.id}`, room: group.room },
    ...group.files.slice(0, taken[at]).map((file): TaskRow => ({ type: "file", key: `file-${file.thing.id}`, file })),
  ]);
  const totalFiles = groups.reduce((sum, group) => sum + group.files.length, 0);
  return { rows, more: totalFiles - taken.reduce((sum, count) => sum + count, 0) };
}

// 줄은 pos 1074에서 1194 사이에 차례로 나타납니다. 창끼리 겹쳐 물결처럼 이어지고(폭은 간격의 2.57배), 줄이 적으면 한 줄이 너무 늘어지지 않게 막아요.
export function rowWindow(index: number, count: number): { from: number; to: number } {
  const step = 120 / (count - 1 + 2.57);
  const from = 1074 + index * step;
  return { from, to: from + Math.min(step * 2.57, 60) };
}

// 종이에 들어가는 만큼만 적습니다. 넘치면 한 단씩 줄여요.
export const fitLadder: number[] = [10, 9, 8, 7, 6, 5, 4, 3, 2];
