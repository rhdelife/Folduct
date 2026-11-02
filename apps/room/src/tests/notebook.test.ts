import { describe, expect, it } from "vitest";
import { fitLadder, rowWindow, taskRows } from "../domain/notebook";
import type { FileRef, NotebookSections } from "../domain/home";
import type { Room, Thing } from "../domain/model";

const room = (id: string) => ({ id, name: id }) as Room;
const file = (owner: string, id: string, days: number): FileRef => ({ room: room(owner), thing: { id, name: id } as Thing, stage: "fallen", days }) as FileRef;
const over = (id: string, extra: number) => ({ room: room(id), usage: { totalBytes: 100 + extra, boxBytes: 0, exact: true }, budgetBytes: 100 });
const first = (files: FileRef[], rooms: ReturnType<typeof over>[] = []): NotebookSections["first"] => {
  const owners = [...new Set(files.map((item) => item.room.id))];
  return { fallen: owners.map((id) => ({ room: room(id), files: files.filter((item) => item.room.id === id) })), overBudget: rooms, sweepOverdue: false } as NotebookSections["first"];
};
const keys = (input: NotebookSections["first"], max: number) => taskRows(input, max).rows.map((row) => row.key);

describe("먼저 볼 것 줄", () => {
  it("방 머리 아래에 그 방 파일을 적어요", () => {
    expect(keys(first([file("a", "f1", 9), file("a", "f2", 8)]), 10)).toEqual(["room-a", "file-f1", "file-f2"]);
  });

  it("한도 넘은 방이 먼저, 그다음 오래된 파일이 있는 방이에요", () => {
    const input = first([file("a", "f1", 3), file("b", "f2", 9), file("c", "f3", 1)], [over("c", 5), over("d", 50)]);
    expect(taskRows(input, 20).rows.filter((row) => row.type === "room").map((row) => row.key)).toEqual(["room-d", "room-c", "room-b", "room-a"]);
  });

  it("칸이 모자라면 방마다 돌아가며 채우고 남은 수를 세요", () => {
    const input = first([file("a", "a1", 9), file("a", "a2", 8), file("a", "a3", 7), file("b", "b1", 6), file("b", "b2", 5)]);
    expect(keys(input, 5)).toEqual(["room-a", "file-a1", "file-a2", "room-b", "file-b1"]);
    expect(taskRows(input, 5)).toMatchObject({ more: 2, moreFiles: 2 });
  });

  it("파일 줄을 못 적을 방은 머리도 적지 않아요", () => {
    const input = first([file("a", "a1", 9), file("b", "b1", 6)]);
    expect(keys(input, 3)).toEqual(["room-a", "file-a1"]);
    expect(taskRows(input, 3).more).toBe(1);
  });

  it("넘은 방은 파일이 없어도 한 줄이고, 못 적으면 남은 수에 들어가요", () => {
    expect(keys(first([], [over("a", 1), over("b", 2)]), 1)).toEqual(["room-b"]);
    expect(taskRows(first([], [over("a", 1), over("b", 2)]), 1)).toMatchObject({ more: 1, moreFiles: 0 });
    expect(taskRows(first([]), 5)).toEqual({ rows: [], more: 0, moreFiles: 0 });
  });

  it("맞추는 단은 위에서 아래로 줄기만 해요", () => {
    fitLadder.slice(1).forEach((step, at) => expect(step.first + step.tilted).toBeLessThan(fitLadder[at].first + fitLadder[at].tilted));
  });
});

describe("줄이 나타나는 창", () => {
  it("1074에서 시작해 1200 안에 끝나고, 앞줄부터 차례로 시작해요", () => {
    for (const count of [1, 2, 5, 9]) {
      const windows = Array.from({ length: count }, (_, at) => rowWindow(at, count));
      expect(windows[0].from).toBe(1074);
      expect(windows.at(-1)!.to).toBeLessThanOrEqual(1200.001);
      windows.slice(1).forEach((window, at) => expect(window.from).toBeGreaterThan(windows[at].from));
    }
  });
});
