import { describe, expect, it } from "vitest";
import { colorGroups } from "../art/palette";
import { dayMs, defaultCare, GB, localDay } from "../domain/care";
import { captionWords, kindGroups, notebookSections, recentFiles, shelfFiles, dialRooms, tableRows } from "../domain/home";
import type { BoxEntry, Room, Thing } from "../domain/model";

const now = new Date(2026, 9, 20, 12).getTime();
const ago = (days: number) => now - days * dayMs;
const box: BoxEntry = { state: "boxed", fromPath: "a", boxPath: "b", at: ago(1) };

function thing(id: string, patch: Partial<Thing> = {}): Thing {
  return { id, path: `${id}.png`, name: `${id}.png`, kind: "image", size: 10, lastModified: ago(30), lastUsedAt: null, missing: false, spot: { x: 3, y: 3 }, note: "", touchedAt: ago(0), pinned: false, box: null, ...patch };
}
function room(id: string, things: Thing[], patch: Partial<Room> = {}): Room {
  return { id, name: id, createdAt: ago(40), source: "handle", rootName: id, scan: { complete: true, failed: 0, at: now, freedBytes: 0 }, things, workDays: [localDay(now)], care: defaultCare, budgetBytes: null, budgetNoticeAt: null, doneOfferAt: null, face: { shape: 0, color: 0 }, ...patch };
}

const fallen = thing("stale", { touchedAt: ago(31), lastModified: ago(31) });
const older = thing("older", { touchedAt: ago(45), lastModified: ago(45) });
const tilted = thing("recent", { touchedAt: ago(4), lastModified: ago(4), kind: "text" });
const fresh = thing("fresh", { kind: "video", size: 3 * GB });
const shelf = thing("shelf", { spot: null, touchedAt: null, lastModified: ago(50), size: 2000 });
const boxed = thing("boxed", { box, touchedAt: ago(9), lastModified: ago(9), kind: "pdf", size: 500 });
const gone = thing("gone", { missing: true, touchedAt: ago(9), lastModified: ago(9) });
const unknown = thing("unknown", { spot: null, touchedAt: null, lastModified: 0 });
const main = room("main", [fallen, older, tilted, fresh, shelf, boxed, gone, unknown], { budgetBytes: GB });
const calm = room("calm", [thing("calm-1")]);
const done = room("done", [thing("done-1", { touchedAt: ago(30), lastModified: ago(30), size: 5 * GB })], { care: { ...defaultCare, done: true } });
const rooms = [done, main, calm];

describe("손댈 것", () => {
  const { first, info, later } = notebookSections(rooms, now, ago(8));

  it("오래된 파일은 방별로, 오래된 것부터 보여요. 완료한 방은 빠져요", () => {
    expect(first.stale.map((item) => item.room.id)).toEqual(["main"]);
    expect(first.stale[0].files.map((file) => file.thing.id)).toEqual(["older", "stale"]);
    expect(first.stale[0].files[0].days).toBe(45);
  });

  it("한도 넘은 방과 밀린 정리를 알려요", () => {
    expect(first.overBudget.map((item) => item.room.id)).toEqual(["main"]);
    expect(first.overBudget[0].budgetBytes).toBe(GB);
    expect(first.sweepOverdue).toBe(true);
    expect(notebookSections(rooms, now, ago(1)).first.sweepOverdue).toBe(false);
    expect(notebookSections(rooms, now).first.sweepOverdue).toBe(false);
    expect(notebookSections([calm], now, ago(8)).first.sweepOverdue).toBe(false);
  });

  it("참고에는 최근 7일에 쓴 파일이 형식별로 있어요", () => {
    const count = Object.fromEntries(info.recent.map((group) => [group.label, group.count]));
    expect(count).toEqual({ 이미지: 1, "글·코드": 1, 영상: 1 });
  });

  it("나중에는 완료한 방과 선반 위 파일 수예요", () => {
    expect(later).toEqual({ doneRooms: 1, shelfFiles: 2 });
  });

  it("방이 없어도 빈 칸으로 돌려줘요", () => {
    expect(notebookSections([], now)).toEqual({ first: { stale: [], overBudget: [], sweepOverdue: false }, info: { recent: [] }, later: { doneRooms: 0, shelfFiles: 0 } });
  });
});

describe("방 표", () => {
  it("큰 파일부터, 상태 말과 어조를 함께 줘요. 사라진 파일은 빠져요", () => {
    const rows = tableRows(main, now);
    expect(rows[0]).toMatchObject({ name: "fresh.png", path: "fresh.png", kind: "video", kindLabel: "영상", status: "제자리", tone: "ok" });
    expect(rows.find((row) => row.name === "boxed.png")).toMatchObject({ status: "정리 상자", tone: "box" });
    expect(rows.find((row) => row.name === "shelf.png")).toMatchObject({ status: "선반", tone: "shelf" });
    expect(rows.find((row) => row.name === "stale.png")).toMatchObject({ status: "31일째 그대로", tone: "stale" });
    expect(rows.find((row) => row.name === "recent.png")).toMatchObject({ status: "제자리", tone: "ok" });
    expect(rows.some((row) => row.name === "gone.png")).toBe(false);
    expect(tableRows(room("empty", []), now)).toEqual([]);
  });
});

describe("수첩에 꺼낼 파일", () => {
  const ids = (files: { thing: { id: string } }[]) => files.map((file) => file.thing.id);

  it("최근 파일과 선반을 따로 꺼내요", () => {
    expect(ids(recentFiles(rooms, now))).toEqual(expect.arrayContaining(["fresh", "calm-1", "recent"]));
    expect(ids(recentFiles(rooms, now))).not.toContain("older");
    expect(ids(shelfFiles(rooms, now))).toEqual(["shelf", "unknown"]);
  });

  it("먼 미래 날짜는 최근이 아니고, 방금 찍혀 now보다 조금 앞선 파일은 최근이에요", () => {
    const stamped = [thing("ahead", { touchedAt: null, lastModified: ago(-400) }), thing("just", { touchedAt: null, lastModified: now + 60_000 })];
    expect(ids(recentFiles([room("clock", stamped)], now))).toEqual(["just"]);
  });
});

describe("방 모음", () => {
  it("진행 중인 방 뒤에 완료한 방까지 모아요", () => {
    const stamps = dialRooms(rooms);
    expect(stamps.map((stamp) => [stamp.room.id, stamp.done])).toEqual([["main", false], ["calm", false], ["done", true]]);
    expect(stamps[1].files).toBe(1);
    expect(stamps[2].bytes).toBe(5 * GB);
  });
});

describe("머리글 숫자", () => {
  it("장면 순서대로 지금 상태를 적어요", () => {
    const words = captionWords(rooms, now);
    expect(words).toHaveLength(5);
    expect(words[0]).toMatch(/^2개 · /);
    expect(words[2]).toMatch(/^3개 · 파일 \d+개$/);
    expect(words[3]).toBe("진행 중 2개 · 완료 1개");
    expect(words[4]).toMatch(/^파일 \d+개 · /);
  });

  it("방이 없고 급한 게 없으면 그렇다고 적어요", () => {
    expect(captionWords([], now)).toEqual(["0개 · 0B", "급한 건 없어요", "0개 · 파일 0개", "진행 중 0개", "파일 0개 · 0B"]);
  });
});

describe("형식별 묶음", () => {
  const drawers = kindGroups(rooms, now);

  it("색 묶음마다 하나, 맨 끝에 정리 상자가 있어요", () => {
    expect(drawers.map((drawer) => drawer.label)).toEqual([...colorGroups.map((group) => group.label), "정리 상자"]);
    expect(drawers.at(-1)).toMatchObject({ box: true, count: 1, bytes: 500 });
    expect(drawers.at(-1)!.top[0].thing.id).toBe("boxed");
  });

  it("개수와 용량, 큰 파일 순서를 세요. 빈 묶음도 있어요", () => {
    const video = drawers.find((drawer) => drawer.label === "영상")!;
    expect(video).toMatchObject({ count: 1, bytes: 3 * GB });
    expect(video.top[0].room.id).toBe("main");
    expect(drawers.find((drawer) => drawer.label === "소리")).toMatchObject({ count: 0, bytes: 0, top: [] });
    expect(drawers.find((drawer) => drawer.label === "PDF·문서·발표")!.count).toBe(0);
    expect(kindGroups(rooms, now, 1).find((drawer) => drawer.label === "이미지")!.top).toHaveLength(1);
  });
});
