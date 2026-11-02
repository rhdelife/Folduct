/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { budgetLevel, budgetNoticeDue, dayMs, defaultCare, GB, lastActivity, localDay, markWorkDay, mergeActivityDays, mergeScan, objectScale, relativeDay, roomUsage, scanOverlap, sizeRatio, suggestBudget, sweepCandidates, thingStage } from "../domain/care";
import { clampSpot, plane, screenDeltaToFloor, toScreen } from "../domain/plane";
import { formatBytes, kindOf, type Room, type ScannedFile, type Thing } from "../domain/model";
import { folderProblem, readFileAt, scanFolder, scanLimits, type DirectorySource } from "../gateways/folder";
import { previewMode } from "../components/FileViewer";
import { clusterSpread, hash, homeActivity, layoutRooms, progressText, roomActivity, roomMess, roomProgress, roomRadius, roomSpots, roomStars, sky, stateAfterDone, vaseHalf, vaseLift } from "../domain/sky";
import { kindParts, vaseBands, vaseIndex, vasePaths } from "../art/vases";
import { buildRoom, looksDone, parseRoomsFile } from "../domain/importFile";
import { fileExists, freeBoxPath, moveFile } from "../gateways/mover";
import { seed, view } from "./fakeFolder";

const MB = 1024 ** 2;
const start = new Date(2026, 9, 5, 12).getTime();

function thing(patch: Partial<Thing> = {}): Thing {
  return { id: crypto.randomUUID(), path: "참고/a.png", name: "a.png", kind: "image", size: 10, lastModified: 0, lastUsedAt: null, missing: false, spot: { x: 3, y: 3 }, note: "", touchedAt: start, pinned: false, box: null, ...patch };
}

function room(things: Thing[], patch: Partial<Room> = {}): Room {
  return { id: "r", name: "방", createdAt: start, source: "handle", rootName: "방", scan: { complete: true, failed: 0, at: start, freedBytes: 0 }, things, workDays: [], care: defaultCare, budgetBytes: null, budgetNoticeAt: null, ...patch };
}

describe("물건 크기", () => {
  it("파일이 클수록 아이콘이 매끄럽게 커진다(1KB 0.7배 → 1GB 2배)", () => {
    // 파일이 클수록 아이콘이 커지고, KB 단위끼리도 차이가 납니다.
    const sizes = [0, 1024, 10 * 1024, 100 * 1024, MB, 10 * MB, 100 * MB, GB, 40 * GB];
    const scales = sizes.map(objectScale);
    // 1KB부터 1GB까지는 계속 커지고, 1GB 이상은 2배에서 멈춥니다.
    for (let i = 1; i < scales.length - 2; i += 1) expect(scales[i + 1]).toBeGreaterThan(scales[i]);
    expect(objectScale(1024)).toBeCloseTo(0.7);
    expect(objectScale(MB)).toBeCloseTo(1.35);
    expect(objectScale(GB)).toBeCloseTo(2);
    expect(objectScale(40 * GB)).toBe(2);
    expect(objectScale(100 * 1024) / objectScale(1024)).toBeGreaterThan(1.5);
    expect(sizeRatio(Number.NaN)).toBe(0);
    expect(formatBytes(1.2 * GB)).toBe("1.2GB");
    expect(formatBytes(5 * GB)).toBe("5GB");
    expect(kindOf("영상.MOV")).toBe("video");
    expect(kindOf("이름없음")).toBe("unknown");
  });
});

describe("방치 판정", () => {
  it("방을 쓴 날이 없으면 오래돼도 쓰러지지 않고, 있으면 3일에 기울고 7일에 쓰러진다", () => {
    const item = thing();
    expect(thingStage(item, defaultCare, [], start + 14 * dayMs).stage).toBe("normal");
    const workDays = [localDay(start + dayMs)];
    expect(thingStage(item, defaultCare, workDays, start + 2 * dayMs).stage).toBe("normal");
    expect(thingStage(item, defaultCare, workDays, start + 3 * dayMs)).toEqual({ stage: "tilted", days: 3 });
    expect(thingStage(item, defaultCare, workDays, start + 7 * dayMs)).toEqual({ stage: "fallen", days: 7 });
  });

  it("고정·쉬는 중·누락·원본이 나중에 고쳐진 물건은 쓰러지지 않는다", () => {
    const workDays = [localDay(start + dayMs)];
    const later = start + 9 * dayMs;
    expect(thingStage(thing({ pinned: true }), defaultCare, workDays, later).stage).toBe("normal");
    expect(thingStage(thing(), { ...defaultCare, resting: true }, workDays, later).stage).toBe("normal");
    expect(thingStage(thing({ missing: true }), defaultCare, workDays, later).stage).toBe("normal");
    expect(thingStage(thing({ lastModified: start + 2 * dayMs }), defaultCare, workDays, later).stage).toBe("normal");
  });

  it("정리 후보는 바닥에 놓인 쓰러진 물건뿐이다", () => {
    const fallen = thing();
    const onShelf = thing({ spot: null });
    const boxed = thing({ box: { state: "virtual", fromPath: "참고/a.png", boxPath: "참고/a.png", at: start } });
    const candidates = sweepCandidates(room([fallen, onShelf, boxed], { workDays: [localDay(start + dayMs)] }), start + 8 * dayMs);
    expect(candidates.map((item) => item.id)).toEqual([fallen.id]);
    expect(markWorkDay(["2026-10-01"], start)).toEqual(["2026-10-01", "2026-10-05"]);
  });
});

describe("방 밖 작업", () => {
  const day = (n: number) => start + n * dayMs;
  const scanned = (path: string, lastModified: number, lastUsedAt?: number | null): ScannedFile => ({ path, name: path, kind: "text", size: 1, lastModified, lastUsedAt });
  const sure = { complete: true, failed: 0 };

  it("마지막 활동은 손댄 때, 고친 때, 방 밖에서 연 때 중 가장 늦은 시각이다", () => {
    expect(lastActivity(thing({ touchedAt: null, lastModified: 3, lastUsedAt: null }))).toBe(3);
    expect(lastActivity(thing({ touchedAt: 9, lastModified: 3, lastUsedAt: 5 }))).toBe(9);
    expect(lastActivity(thing({ touchedAt: 1, lastModified: 3, lastUsedAt: 5 }))).toBe(5);
  });

  it("방 밖에서 쓰면 그때부터 다시 세고, 그 뒤로 방을 쓴 날이 있어야 기운다", () => {
    const item = thing({ lastUsedAt: day(5) });
    const workDays = [localDay(day(1)), localDay(day(6))];
    expect(thingStage(item, defaultCare, workDays, day(7))).toEqual({ stage: "normal", days: 2 });
    expect(thingStage(item, defaultCare, workDays, day(8))).toEqual({ stage: "tilted", days: 3 });
    expect(thingStage(item, defaultCare, workDays, day(12))).toEqual({ stage: "fallen", days: 7 });
    // 마지막 활동 날이나 그 전에만 방을 썼으면 오래돼도 그대로입니다.
    expect(thingStage(item, defaultCare, [localDay(day(1)), localDay(day(5))], day(30))).toEqual({ stage: "normal", days: 25 });
    // 고친 날도 같은 기준이고, 고쳤다고 영원히 서 있지는 않습니다.
    expect(thingStage(thing({ lastModified: day(2) }), defaultCare, [localDay(day(3))], day(9))).toEqual({ stage: "fallen", days: 7 });
    expect(thingStage(thing({ touchedAt: null, lastUsedAt: day(1) }), defaultCare, workDays, day(30))).toEqual({ stage: "normal", days: 0 });
  });

  it("다시 봐도 마지막 사용 시각은 뒤로 가거나 null로 돌아가지 않는다", () => {
    const merged = (stored: number | null, seen?: number | null) => mergeScan(room([thing({ path: "a", lastUsedAt: stored })]), [scanned("a", 0, seen)], sure, start).things[0].lastUsedAt;
    expect(merged(100, null)).toBe(100);
    expect(merged(100, undefined)).toBe(100);
    expect(merged(100, 50)).toBe(100);
    expect(merged(100, 200)).toBe(200);
    expect(merged(null, 200)).toBe(200);
    expect(merged(null, null)).toBeNull();
    expect(mergeScan(room([]), [scanned("새 파일", 0, 7)], sure, start).things[0].lastUsedAt).toBe(7);
  });

  it("방 밖 작업 날은 최근 60일 안, 미래가 아닌 날만 방을 쓴 날이 된다", () => {
    const now = day(100);
    const files = [
      { lastModified: day(99), lastUsedAt: day(90) },
      { lastModified: day(30), lastUsedAt: day(41) },
      { lastModified: day(101), lastUsedAt: null },
    ];
    expect(mergeActivityDays(["2020-01-01"], files, now)).toEqual(["2020-01-01", localDay(day(41)), localDay(day(90)), localDay(day(99))]);
    const many = Array.from({ length: 70 }, (_, i) => localDay(day(i)));
    expect(mergeActivityDays(many, [{ lastModified: day(70), lastUsedAt: null }], day(70))).toEqual([...many.slice(11), localDay(day(70))]);
  });

  it("다시 보기와 새 방 만들기 모두 방 밖 작업을 방을 쓴 날로 친다", () => {
    expect(mergeScan(room([]), [scanned("a", day(2), day(3))], sure, day(4)).workDays).toEqual([localDay(day(2)), localDay(day(3))]);
    const built = buildRoom({ name: "방", source: "input", rootName: "방", files: [scanned("a", day(1), day(2))], scan: sure, budgetBytes: null, done: false, workDays: [], now: day(4) });
    expect(built.workDays).toEqual([localDay(day(1)), localDay(day(2))]);
    expect(built.things[0].lastUsedAt).toBe(day(2));
  });

  it("다른 파일을 밖에서 쓴 날이 있으면 그대로인 물건이 기운다", () => {
    const still = thing({ path: "a" });
    const next = mergeScan(room([still]), [scanned("a", 0), scanned("b", day(4), day(5))], sure, day(8));
    expect(thingStage(next.things[0], defaultCare, next.workDays, day(8)).stage).toBe("fallen");
  });

  it("아무도 쓰지 않은 방은 기울지 않는다: 활동이 없거나, 모든 파일의 마지막 활동이 같은 옛날 하루여도", () => {
    const untouched = mergeScan(room([thing({ path: "a" })]), [scanned("a", 0)], sure, day(30));
    expect(untouched.workDays).toEqual([]);
    expect(roomMess(untouched, day(30))).toEqual({ tilted: 0, fallen: 0 });

    const old = room([thing({ path: "a", touchedAt: day(-10) }), thing({ path: "b", touchedAt: day(-10) })]);
    const scanOnly = mergeScan(old, [scanned("a", day(0), day(0) + 1000), scanned("b", day(-3), day(0))], sure, day(20));
    expect(scanOnly.workDays).toEqual([localDay(day(-3)), localDay(day(0))]);
    expect(roomMess(scanOnly, day(20))).toEqual({ tilted: 0, fallen: 0 });

    const files = [scanned("a", day(0)), scanned("b", day(0), day(0))];
    const built = buildRoom({ name: "방", source: "input", rootName: "방", files, scan: sure, budgetBytes: null, done: false, workDays: [], now: day(20) });
    const again = mergeScan(built, files, sure, day(50));
    expect(roomMess(again, day(50))).toEqual({ tilted: 0, fallen: 0 });
  });

  it("어제 연 폴더는 오래전에 고쳤어도 완료로 보지 않는다", () => {
    expect(looksDone([scanned("a", day(0), day(99))], day(100))).toBe(false);
    expect(looksDone([scanned("a", day(0), day(30))], day(100))).toBe(true);
    expect(looksDone([scanned("a", day(0), null)], day(100))).toBe(true);
  });

  it("가져오기 파일의 lastUsedAt은 없어도 되고, 맞는 값만 받는다", () => {
    const parsed = parseRoomsFile(JSON.stringify({ kind: "folduct-rooms", version: 1, rooms: [{ name: "x", origin: "/x", complete: true, failed: 0, files: ["a", "b", "c", "d"].map((path, i) => ({ path, size: 1, lastModified: 0, ...(i === 0 ? {} : { lastUsedAt: [5, -1, "어제"][i - 1] }) })) }] }))!;
    expect(parsed.skipped).toBe(0);
    expect(parsed.rooms[0].files.map((item) => item.lastUsedAt)).toEqual([null, 5, null, null]);
  });

  it("상대 날짜는 달력 날짜로 센다", () => {
    const now = new Date(2026, 9, 5, 1).getTime();
    expect(relativeDay(new Date(2026, 9, 5, 0).getTime(), now)).toBe("오늘");
    expect(relativeDay(new Date(2026, 9, 4, 23).getTime(), now)).toBe("어제");
    expect(relativeDay(new Date(2026, 9, 2, 12).getTime(), now)).toBe("3일 전");
    expect(relativeDay(now + dayMs, now)).toBe("오늘");
  });

  it("진행 상황은 있는 파일의 마지막 활동과 최근 7일 수만 말하고, 비율은 내지 않는다", () => {
    const now = day(10);
    const box = { state: "virtual" as const, fromPath: "a", boxPath: "a", at: start };
    const r = room([
      thing({ touchedAt: null, lastUsedAt: day(9) }),
      thing({ touchedAt: day(3) }),
      thing({ touchedAt: null, lastModified: day(1) }),
      thing({ lastUsedAt: day(10), missing: true }),
      thing({ lastUsedAt: day(10), box }),
    ]);
    const progress = roomProgress(r, now);
    expect(progress).toEqual({ lastActivityAt: day(9), recentCount: 2 });
    expect(progressText(progress, now)).toBe("마지막 작업 어제 · 최근 7일에 2개 사용");
    expect(progressText(roomProgress(r, day(30)), day(30))).toBe("마지막 작업 21일 전");
    const blank = roomProgress(room([thing({ touchedAt: null })]), now);
    expect(blank).toEqual({ lastActivityAt: null, recentCount: 0 });
    expect(progressText(blank, now)).toBeNull();
  });

  it("완료를 풀면 쉬던 방은 잠시 쉼으로, 나머지는 진행 중으로 돌아간다", () => {
    expect(stateAfterDone({ resting: true })).toBe("잠시 쉼");
    expect(stateAfterDone({ resting: false })).toBe("진행 중");
  });

  it("하루 작업량은 손댄·고친·방 밖에서 연 파일을 그날 한 번씩 센다", () => {
    const now = day(13);
    const r = room([
      thing({ touchedAt: now, lastModified: now, lastUsedAt: now }),
      thing({ touchedAt: null, lastUsedAt: now }),
      thing({ touchedAt: null, lastModified: day(12), lastUsedAt: now }),
      thing({ touchedAt: day(11), lastModified: 0 }),
    ]);
    expect(roomActivity(r, now).slice(-3).map((bar) => bar.value)).toEqual([1, 1, 3]);
  });
});

describe("방 용량", () => {
  it("같은 파일은 한 번, 상자 안 파일은 따로, 누락은 빼고 센다", () => {
    const a = thing({ size: 2 * GB });
    const boxed = thing({ path: "_Folduct 정리상자/참고/b.png", size: GB });
    const gone = thing({ path: "c.png", size: 9 * GB, missing: true });
    expect(roomUsage(room([a, { ...a, id: "dup" }, boxed, gone]))).toEqual({ totalBytes: 3 * GB, boxBytes: GB, exact: true });
  });

  it("부분 스캔은 최소값이라 방 크기를 넘어도 경고하지 않는다", () => {
    const big = [thing({ size: 9 * GB })];
    expect(budgetLevel(roomUsage(room(big, { scan: { complete: false, failed: 0, at: start, freedBytes: 0 } })), GB)).toBe("partial");
    expect(budgetLevel(roomUsage(room(big, { scan: { complete: true, failed: 2, at: start, freedBytes: 0 } })), GB)).toBe("partial");
    const usage = roomUsage(room(big));
    expect([null, 20 * GB, 11 * GB, 5 * GB].map((budget) => budgetLevel(usage, budget))).toEqual(["unset", "ok", "near", "over"]);
  });

  it("넘친 방 배너는 주 1회, 제안값은 현재 × 1.5를 GB로 반올림한다", () => {
    const over = room([thing({ size: 6 * GB })], { budgetBytes: 5 * GB });
    expect(budgetNoticeDue(over, start)).toBe(true);
    expect(budgetNoticeDue({ ...over, budgetNoticeAt: start }, start + 6 * dayMs)).toBe(false);
    expect(budgetNoticeDue({ ...over, budgetNoticeAt: start }, start + 7 * dayMs)).toBe(true);
    expect(suggestBudget(2.1 * GB)).toBe(3 * GB);
    expect(suggestBudget(100 * MB)).toBe(GB);
  });
});

describe("다시 보기", () => {
  it("메모와 자리는 지키고, 새 파일은 선반에, 사라진 파일은 누락으로, 비운 용량을 기록한다", () => {
    const kept = thing({ path: "a.png", size: 2 * GB, note: "왜 두었나" });
    const gone = thing({ path: "b.mov", size: GB });
    const next = mergeScan(room([kept, gone]), [{ path: "a.png", name: "a.png", kind: "image", size: 2 * GB, lastModified: 5 }, { path: "new.txt", name: "new.txt", kind: "text", size: 3, lastModified: 5 }], { complete: true, failed: 0 }, start);
    expect(next.things.find((item) => item.id === kept.id)).toMatchObject({ note: "왜 두었나", spot: kept.spot, lastModified: 5, missing: false });
    expect(next.things.find((item) => item.id === gone.id)?.missing).toBe(true);
    expect(next.things.find((item) => item.path === "new.txt")?.spot).toBeNull();
    expect(next.scan.freedBytes).toBe(GB - 3);
  });

  it("Finder에서 상자 속 파일을 원래 자리로 돌려놓으면 상자 기록을 푼다", () => {
    const boxed = thing({ path: "_Folduct 정리상자/a.png", box: { state: "boxed", fromPath: "a.png", boxPath: "_Folduct 정리상자/a.png", at: start } });
    const next = mergeScan(room([boxed]), [{ path: "a.png", name: "a.png", kind: "image", size: 10, lastModified: 0 }], { complete: true, failed: 0 }, start);
    expect(next.things).toHaveLength(1);
    expect(next.things[0]).toMatchObject({ path: "a.png", box: null, missing: false });
  });

  const file = (path: string, size = 10): ScannedFile => ({ path, name: path.split("/").pop()!, kind: kindOf(path), size, lastModified: 0 });

  it("옮기던 중 멈춘 물건의 파일이 상자 쪽에만 있어도 물건은 하나다", () => {
    const moving = thing({ path: "a.png", note: "메모", box: { state: "moving-in", fromPath: "a.png", boxPath: "_Folduct 정리상자/a.png", at: start } });
    const next = mergeScan(room([moving]), [file("_Folduct 정리상자/a.png")], { complete: true, failed: 0 }, start);
    expect(next.things).toHaveLength(1);
    expect(next.things[0]).toMatchObject({ id: moving.id, note: "메모", missing: false });
  });

  it("부분 스캔에서 못 본 파일은 '파일 없음'으로 바꾸지 않는다", () => {
    const unseen = thing({ path: "b.mov", size: GB });
    const partial = mergeScan(room([unseen]), [file("a.png")], { complete: false, failed: 0 }, start);
    expect(partial.things.find((item) => item.id === unseen.id)?.missing).toBe(false);
    expect(partial.scan.freedBytes).toBe(0);
    expect(mergeScan(room([unseen]), [file("a.png")], { complete: true, failed: 0 }, start).things.find((item) => item.id === unseen.id)?.missing).toBe(true);
  });

  it("읽지 못한 항목이 있는 스캔은 못 본 파일을 '파일 없음'으로 바꾸지 않고, 비운 용량으로도 세지 않는다", () => {
    const unseen = thing({ path: "잠긴폴더/b.mov", size: GB });
    const moving = thing({ path: "c.png", box: { state: "moving-in", fromPath: "c.png", boxPath: "_Folduct 정리상자/c.png", at: start } });
    const next = mergeScan(room([unseen, moving]), [file("a.png")], { complete: true, failed: 1 }, start);
    expect(next.things.find((item) => item.id === unseen.id)?.missing).toBe(false);
    expect(next.things.find((item) => item.id === moving.id)?.missing).toBe(false);
    expect(next.scan.freedBytes).toBe(0);
    expect(next.scan.failed).toBe(1);
  });

  it("방에는 스캔의 네 칸만 남기고, 이름과 종류는 스캔한 파일을 따른다", () => {
    const stale = thing({ path: "index.html", name: "cover.png", kind: "image" });
    const scan = { complete: true, failed: 0, files: [file("index.html")], note: "파일 1,000개까지만 방에 들였어요." };
    const next = mergeScan(room([stale]), scan.files, scan, start);
    expect(Object.keys(next.scan).sort()).toEqual(["at", "complete", "failed", "freedBytes"]);
    expect(next.things[0]).toMatchObject({ name: "index.html", kind: "text" });
  });

  it("폴더 겹침은 지금 있는(없어지지도 상자에 들지도 않은) 물건만 센다", () => {
    const things = [thing({ path: "a.png" }), thing({ path: "b.png" }), thing({ path: "c.png", missing: true }), thing({ path: "d.png", box: { state: "virtual", fromPath: "d.png", boxPath: "d.png", at: start } })];
    expect(scanOverlap(room(things), [file("a.png"), file("c.png"), file("d.png"), file("new.png")])).toEqual({ kept: 1, total: 2 });
  });
});

describe("방 좌표", () => {
  it("화면에서 끈 거리를 바닥 칸으로 되돌리고, 벽 밖으로는 못 나간다", () => {
    const from = toScreen({ x: 3, y: 4 });
    const to = toScreen({ x: 5.5, y: 2 });
    const delta = screenDeltaToFloor(to.left - from.left, to.top - from.top);
    expect(delta.x).toBeCloseTo(2.5);
    expect(delta.y).toBeCloseTo(-2);
    expect(clampSpot({ x: -3, y: 99 })).toEqual({ x: 0.6, y: plane.floor - 0.9 });
  });
});

describe("폴더를 못 읽은 이유", () => {
  it("브라우저 오류를 이름으로 나눈다", () => {
    expect(folderProblem(new DOMException("x", "NotAllowedError"))).toBe("denied");
    expect(folderProblem(new DOMException("x", "SecurityError"))).toBe("denied");
    expect(folderProblem(new DOMException("x", "NotFoundError"))).toBe("gone");
    expect(folderProblem(new DOMException("permission denied", "AbortError"))).toBe("other");
  });

  it("Tauri가 문자열로 준 거절을 나눈다", () => {
    for (const text of ["forbidden path: /Users/a/방", "path not allowed on the configured scope", "Operation not permitted", "failed to read: Permission denied", "read_dir failed (os error 1)", "read_dir failed (os error 13)"]) expect(folderProblem(text), text).toBe("denied");
    for (const text of ["No such file or directory", "read_dir failed (os error 2)", "path not found"]) expect(folderProblem(text), text).toBe("gone");
    expect(folderProblem(new Error("No such file or directory (os error 2)"))).toBe("gone");
  });

  it("비슷한 번호나 모르는 오류는 그 밖의 오류로 둔다", () => {
    for (const text of ["Input/output error (os error 5)", "os error 10", "os error 28", "Is a directory (os error 21)"]) expect(folderProblem(text), text).toBe("other");
    expect(folderProblem(undefined)).toBe("other");
  });
});

describe("폴더 읽기", () => {
  it("숨김 파일과 node_modules는 빼고 하위 경로를 남긴다", async () => {
    type Node = { name: string; size?: number; children?: Node[] };
    const source = (nodes: Node[]): DirectorySource => ({
      async *list() {
        for (const node of nodes) yield { name: node.name, kind: node.children ? "directory" : "file" };
      },
      async file(name) {
        return { size: nodes.find((node) => node.name === name)?.size ?? 1, lastModified: 0 };
      },
      async directory(name) {
        return source(nodes.find((node) => node.name === name)?.children ?? []);
      },
    });
    const result = await scanFolder(source([{ name: ".DS_Store" }, { name: "node_modules", children: [{ name: "x.js" }] }, { name: "영상", children: [{ name: "a.mov", size: GB }] }, { name: "메모.md", size: 3 }]));
    expect(result.files.map((file) => [file.path, file.kind, file.size])).toEqual([["영상/a.mov", "video", GB], ["메모.md", "text", 3]]);
    expect(result.complete).toBe(true);
  });

  const unreadable: DirectorySource = {
    list: () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new DOMException("없음", "NotFoundError")) }) }),
    file: () => Promise.reject(new DOMException("없음", "NotFoundError")),
    directory: () => Promise.reject(new DOMException("없음", "NotFoundError")),
  };

  it("방 폴더 자체를 읽지 못하면(옮겨짐·드라이브 분리) 빈 폴더로 치지 않고 실패한다", async () => {
    await expect(scanFolder(unreadable)).rejects.toThrow();
  });

  it("하위 폴더만 읽지 못하면 나머지는 읽고 실패 수를 남긴다", async () => {
    const source: DirectorySource = {
      async *list() {
        yield { name: "잠긴폴더", kind: "directory" };
        yield { name: "a.png", kind: "file" };
      },
      file: async () => ({ size: 1, lastModified: 0 }),
      directory: async () => unreadable,
    };
    const result = await scanFolder(source);
    expect(result.files.map((file) => file.path)).toEqual(["a.png"]);
    expect(result.failed).toBe(1);
  });

  it("파일 한도를 채우면 남은 폴더를 더 읽지 않고, 딱 한도만큼이면 다 읽은 것으로 친다", async () => {
    let lists = 0;
    const tree = (entries: { name: string; kind: "file" | "directory" }[]): DirectorySource => ({
      async *list() {
        lists += 1;
        yield* entries;
      },
      file: async () => ({ size: 1, lastModified: 0 }),
      directory: async () => tree([0, 1, 2].map((i) => ({ name: `${i}.txt`, kind: "file" as const }))),
    });
    const folders = (count: number) => Array.from({ length: count }, (_, i) => ({ name: `d${i}`, kind: "directory" as const }));
    const over = await scanFolder(tree(folders(2000)));
    expect(over.files).toHaveLength(scanLimits.files);
    expect(over.complete).toBe(false);
    // 방 폴더 1번 + 한 폴더에 3개씩 1000개를 채울 때까지의 폴더 334번.
    expect(lists).toBe(335);

    const exact = await scanFolder(tree(Array.from({ length: scanLimits.files }, (_, i) => ({ name: `${i}.txt`, kind: "file" as const }))));
    expect(exact.files).toHaveLength(scanLimits.files);
    expect(exact.complete).toBe(true);
  });
});

describe("정리 상자 폴더 이동", () => {
  it("파일을 상자로 옮기고 원래 자리로 되돌린다", async () => {
    const root = view(seed());
    const boxPath = await freeBoxPath(root, "참고/시안.psd");
    expect(boxPath).toBe("_Folduct 정리상자/참고/시안.psd");
    expect(await moveFile(root, "참고/시안.psd", boxPath!)).toEqual({ ok: true });
    expect(await fileExists(root, "참고/시안.psd")).toBe(false);
    expect(await moveFile(root, boxPath!, "참고/시안.psd")).toEqual({ ok: true });
    expect(await fileExists(root, "참고/시안.psd")).toBe(true);
  });

  it("덮어쓰지 않는다: 상자 안 이름이 겹치면 (2), 되돌릴 자리가 차 있으면 거절", async () => {
    const raw = seed();
    const root = view(raw);
    await moveFile(root, "참고/시안.psd", "_Folduct 정리상자/참고/시안.psd");
    raw.dirs.get("참고")!.files.set("시안.psd", "새 파일");
    expect(await freeBoxPath(root, "참고/시안.psd")).toBe("_Folduct 정리상자/참고/시안 (2).psd");
    expect(await moveFile(root, "_Folduct 정리상자/참고/시안.psd", "참고/시안.psd")).toMatchObject({ ok: false, reason: "occupied" });
    expect(raw.dirs.get("참고")!.files.get("시안.psd")).toBe("새 파일");
  });

  it("상자 밖끼리의 이동, 위험한 경로, 이동을 못 하는 브라우저는 거절한다", async () => {
    expect((await moveFile(view(seed()), "참고/시안.psd", "다른곳/시안.psd")).ok).toBe(false);
    expect((await moveFile(view(seed()), "../밖/시안.psd", "_Folduct 정리상자/시안.psd")).ok).toBe(false);
    expect(await moveFile(view(seed(), false), "참고/시안.psd", "_Folduct 정리상자/시안.psd")).toMatchObject({ ok: false, reason: "unsupported" });
  });

  it("앱 소스는 파일을 지우거나 고쳐 쓰는 API를 쓰지 않는다", () => {
    const sources = import.meta.glob(["../**/*.ts", "../**/*.tsx", "!../tests/**"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    expect(Object.keys(sources).length).toBeGreaterThan(10);
    expect(Object.entries(sources).filter(([, text]) => /\b(removeEntry|createWritable)\s*\(/.test(text)).map(([path]) => path)).toEqual([]);
  });
});

describe("밤하늘 지도", () => {
  it("방은 하늘 안에 서로 떨어져 놓이고, 같은 id는 늘 같은 자리에 뜬다", () => {
    for (const count of [1, 2, 3, 6, 12]) {
      const spots = roomSpots(count);
      expect(spots).toHaveLength(count);
      for (const spot of spots) {
        expect(spot.x).toBeGreaterThan(0);
        expect(spot.x).toBeLessThan(sky.width);
        expect(spot.y).toBeGreaterThan(0);
        expect(spot.y).toBeLessThan(sky.height);
      }
    }
    expect(hash("abc")).toBe(hash("abc"));
    expect(Math.abs(hash("t1") - hash("t2"))).toBeGreaterThan(0.01);
  });

  it("파일 별은 방 고리 밖에 뜨고, 쓰러진 파일일수록 멀리 있으며, 상자 속 파일은 뜨지 않는다", () => {
    const workDays = [localDay(start + dayMs)];
    const fresh = thing({ touchedAt: start + 8 * dayMs });
    const fallen = thing();
    const boxed = thing({ box: { state: "virtual", fromPath: "a", boxPath: "a", at: start } });
    const r = room([fresh, fallen, boxed], { workDays });
    const center = roomSpots(3)[1];
    const stars = roomStars(r, center, clusterSpread(3), start + 8 * dayMs);
    expect(stars.map((star) => star.thing.id)).toEqual([fresh.id, fallen.id]);
    const distance = (id: string) => {
      const star = stars.find((item) => item.thing.id === id)!;
      return Math.hypot(star.x - center.x, (star.y - center.y) / 0.8);
    };
    expect(stars.find((star) => star.thing.id === fallen.id)?.stage).toBe("fallen");
    expect(distance(fresh.id)).toBeGreaterThan(roomRadius(r) + 7);
    expect(distance(fallen.id)).toBeGreaterThan(distance(fresh.id));
  });

  it("화병은 방마다 정해지고, 형식별 용량이 바닥부터 한도 비율만큼 쌓인다", () => {
    expect(vaseIndex("방-1")).toBe(vaseIndex("방-1"));
    expect(new Set(Array.from({ length: 80 }, (_, i) => vaseIndex(`방-${i}`))).size).toBe(vasePaths.length);
    for (const path of vasePaths) expect(path).not.toContain("NaN");

    const parts = kindParts([thing({ kind: "image", size: 30 }), thing({ kind: "video", size: 10 }), thing({ kind: "pdf", size: 60, missing: true })]);
    expect(parts.map((part) => [part.label, part.size])).toEqual([["이미지", 30], ["영상", 10]]);
    const half = vaseBands(parts, 0.5);
    expect(half.map((band) => band.height)).toEqual([75, 25]);
    expect(half[0].y + half[0].height).toBe(100);
    expect(half[1].y + half[1].height).toBe(half[0].y);
    expect(half[1].y).toBe(0);
    // 한도를 넘어도 화병 밖으로 넘치지 않고, 한도가 없으면 비어 있습니다.
    expect(vaseBands(parts, 1.4)[1].y).toBe(-100);
    expect(vaseBands(parts, 0)).toEqual([]);
  });

  it("파일은 커진 화병과 이름표 자리를 피해 뜬다", () => {
    const things = Array.from({ length: 40 }, (_, i) => thing({ path: `f${i}.png`, id: `t${i}`, size: 5 * MB }));
    const r = room(things);
    const center = { x: 500, y: 300 };
    const half = vaseHalf(roomRadius(r));
    for (const star of roomStars(r, center, clusterSpread(3), start)) {
      const dx = star.x - center.x;
      const dy = star.y - center.y;
      expect(Math.abs(dx) >= star.r + 100 || dy + star.r <= half || dy - star.r >= half * vaseLift + 60).toBe(true);
      expect(Math.hypot(dx, dy)).toBeGreaterThan(half * vaseLift);
    }
  });

  it("최근 14일 작업량을 하루씩 센다", () => {
    const now = start + 13 * dayMs;
    const a = room([thing({ touchedAt: now })], { workDays: [localDay(now), localDay(start)] });
    const b = room([], { id: "b", workDays: [localDay(now)] });
    const home = homeActivity([a, b], now);
    expect(home).toHaveLength(14);
    expect(home[0]).toEqual({ day: localDay(start), value: 1 });
    expect(home[13]).toEqual({ day: localDay(now), value: 2 });
    expect(roomActivity(a, now)[13]).toEqual({ day: localDay(now), value: 1, worked: true });
  });
});

describe("한꺼번에 가져오기", () => {
  const file = (rooms: unknown[]) => JSON.stringify({ kind: "folduct-rooms", version: 1, exportedAt: start, rooms });

  it("모양이 맞는 방과 파일만 받고, 빠진 파일이 있으면 부분 목록으로 본다", () => {
    expect(parseRoomsFile("{망가진 json")).toBeNull();
    expect(parseRoomsFile(JSON.stringify({ kind: "다른 것", version: 1, rooms: [] }))).toBeNull();
    const parsed = parseRoomsFile(file([
      { name: " booklens ", origin: "/Users/me/booklens", complete: true, failed: 0, files: [{ path: "src/App.tsx", name: "App.tsx", size: 10, lastModified: start }, { path: "../밖.txt", name: "밖.txt", size: 1, lastModified: 0 }] },
      { name: "", origin: "/x", files: [] },
      { name: "hemp", origin: "/Users/me/hemp", complete: true, failed: 0, files: [] },
    ]))!;
    expect(parsed.skipped).toBe(2);
    expect(parsed.rooms.map((item) => [item.name, item.complete, item.files.length])).toEqual([["booklens", false, 1], ["hemp", true, 0]]);
    expect(parsed.rooms[0].files[0].kind).toBe("text");
  });

  it("파일 이름과 종류는 따로 적힌 name이 아니라 경로의 마지막 칸에서 정한다", () => {
    const parsed = parseRoomsFile(file([{ name: "x", origin: "/x", complete: true, failed: 0, files: [{ path: "notes/index.html", name: "cover.png", size: 1, lastModified: 0 }] }]))!;
    expect(parsed.rooms[0].files[0]).toMatchObject({ name: "index.html", kind: "text" });
    const built = buildRoom({ name: "x", source: "input", rootName: "x", files: [], scan: parsed.rooms[0], budgetBytes: null, done: false, workDays: [], now: start });
    expect(Object.keys(built.scan).sort()).toEqual(["at", "complete", "failed", "freedBytes"]);
  });

  it("60일 넘게 고친 파일이 없으면 완료로 보고, 새 방은 최근 파일 6개만 바닥에 놓는다", () => {
    const files = Array.from({ length: 9 }, (_, i) => ({ path: `f${i}.txt`, name: `f${i}.txt`, kind: "text" as const, size: 1, lastModified: start - i * dayMs }));
    expect(looksDone(files, start + 10 * dayMs)).toBe(false);
    expect(looksDone(files, start + 61 * dayMs)).toBe(true);
    expect(looksDone([], start)).toBe(true);
    const built = buildRoom({ name: "방", source: "input", rootName: "방", origin: "/Users/me/방", files, scan: { complete: true, failed: 0 }, budgetBytes: null, done: true, workDays: [], now: start });
    expect(built.things.filter((item) => item.spot).map((item) => item.path).sort()).toEqual(["f0.txt", "f1.txt", "f2.txt", "f3.txt", "f4.txt", "f5.txt"]);
    expect(built.care.done).toBe(true);
    expect(built.origin).toBe("/Users/me/방");
  });
});

describe("완료한 프로젝트", () => {
  it("기울지 않고, 주간 정리 후보도 없고, 용량 경고도 쉬지만 다시 진행 중으로 돌리면 돌아온다", () => {
    const done = { ...defaultCare, done: true };
    const workDays = [localDay(start + dayMs)];
    expect(thingStage(thing(), done, workDays, start + 9 * dayMs).stage).toBe("normal");
    expect(thingStage(thing(), defaultCare, workDays, start + 9 * dayMs).stage).toBe("fallen");
    const finished = room([thing({ size: 6 * GB })], { care: done, workDays, budgetBytes: 5 * GB });
    expect(sweepCandidates(finished, start + 9 * dayMs)).toEqual([]);
    expect(budgetNoticeDue(finished, start)).toBe(false);
    expect(budgetNoticeDue({ ...finished, care: defaultCare }, start)).toBe(true);
  });

  it("완료한 방은 지도에 놓지 않고, 진행 중인 방이 많아도 판 안에 놓는다", () => {
    const rooms = Array.from({ length: 43 }, (_, i) => room([], { id: `r${i}`, care: { ...defaultCare, done: i >= 12 } }));
    const placed = layoutRooms(rooms);
    expect(placed.map((p) => p.room.id)).toEqual(rooms.slice(0, 12).map((r) => r.id));
    for (const p of placed) {
      expect(p.at.x).toBeGreaterThanOrEqual(40);
      expect(p.at.x).toBeLessThanOrEqual(sky.width - 40);
      expect(p.at.y).toBeGreaterThanOrEqual(40);
      expect(p.at.y).toBeLessThanOrEqual(sky.height - 40);
    }
  });

  it("방이 없거나 모두 완료했으면 지도가 빈다", () => {
    expect(layoutRooms([])).toEqual([]);
    expect(layoutRooms([room([], { care: { ...defaultCare, done: true } })])).toEqual([]);
  });
});

describe("파일 열기", () => {
  it("브라우저가 보여줄 수 있는 형식만 미리보고, 나머지는 경로로 안내한다", () => {
    const mode = (name: string) => previewMode({ name, kind: kindOf(name) });
    expect(["표지.png", "최종.mov", "녹음.m4a", "기획서.pdf", "메모.md", "예산.csv", "발표.pptx", "시안.psd", "모음.zip"].map(mode)).toEqual(["image", "video", "audio", "pdf", "text", "text", "none", "none", "none"]);
  });

  it("방 폴더 안의 하위 경로로 파일을 읽고, 폴더 밖 경로는 열지 않는다", async () => {
    const seen: string[] = [];
    const dir = (name: string): FileSystemDirectoryHandle => ({
      getDirectoryHandle: async (child: string) => { seen.push(`dir:${child}`); return dir(child); },
      getFileHandle: async (file: string) => ({ getFile: async () => new File(["내용"], file) }),
    }) as unknown as FileSystemDirectoryHandle;
    const file = await readFileAt(dir("root"), "글/메모/오늘.md");
    expect(file.name).toBe("오늘.md");
    expect(seen).toEqual(["dir:글", "dir:메모"]);
    await expect(readFileAt(dir("root"), "../밖/비밀.txt")).rejects.toThrow();
  });
});
