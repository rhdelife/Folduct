/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { dayMs, defaultCare, doneOfferDue, GB, handTouchedAt, lastActivity, localDay, markWorkDay, mergeActivityDays, mergeScan, newFileCount, normalizeCare, objectScale, relativeDay, roomUsage, scanOverlap, shownActivity, sizeRatio, laneOf, laneOrder, sweepCandidates, thingAge } from "../domain/care";
import { clampSpot, plane, screenDeltaToFloor, toScreen } from "../domain/plane";
import { formatBytes, kindOf, type Room, type ScannedFile, type Thing } from "../domain/model";
import { folderProblem, readFileAt, scanFolder, scanLimits, type DirectorySource } from "../gateways/folder";
import { previewMode } from "../components/FileViewer";
import { clusterSpread, hash, homeActivity, homeLimit, progressText, roomActivity, staleCount, roomProgress, roomRadius, roomSpots, roomStars, roomsToKeep, sky, vaseHalf, vaseLift } from "../domain/sky";
import { kindParts } from "../art/duct";
import { buildRoom, looksDone, parseRoomsFile } from "../domain/importFile";
import { fileExists, freeBoxPath, moveFile, renameFile } from "../gateways/mover";
import { seed, view } from "./fakeFolder";

const MB = 1024 ** 2;
const start = new Date(2026, 9, 5, 12).getTime();

function thing(patch: Partial<Thing> = {}): Thing {
  return { id: crypto.randomUUID(), path: "참고/a.png", name: "a.png", kind: "image", size: 10, lastModified: 0, lastUsedAt: null, missing: false, spot: { x: 3, y: 3 }, note: "", touchedAt: start, seenAt: start, pinned: false, box: null, ...patch };
}

// 옛 시험의 (물건, 돌보기, 방 쓴 날, 지금) 꼴을 그대로 둡니다. 방은 시작 날에 만들었어요.
const age = (item: Thing, care: Room["care"], workDays: string[], now: number) => thingAge(item, { care, workDays, createdAt: start }, now);

function room(things: Thing[], patch: Partial<Room> = {}): Room {
  return { id: "r", name: "방", createdAt: start, source: "handle", rootName: "방", scan: { complete: true, failed: 0, at: start, freedBytes: 0 }, things, workDays: [], care: defaultCare, doneOfferAt: null, face: { shape: 0, color: 0 }, ...patch };
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
  it("방을 쓴 날이 없으면 오래돼도 오래됨이 아니고, 있으면 30일부터 오래됨이다", () => {
    const item = thing();
    expect(age(item, defaultCare, [], start + 60 * dayMs).stale).toBe(false);
    const workDays = [localDay(start + dayMs)];
    expect(age(item, defaultCare, workDays, start + 29 * dayMs)).toEqual({ stale: false, days: 29 });
    expect(age(item, defaultCare, workDays, start + 30 * dayMs)).toEqual({ stale: true, days: 30 });
  });

  it("방마다 정한 기준을 따른다", () => {
    const workDays = [localDay(start + dayMs)];
    expect(age(thing(), { ...defaultCare, staleAfterDays: 7 }, workDays, start + 7 * dayMs).stale).toBe(true);
  });

  it("고정·누락·원본이 나중에 고쳐진 물건은 오래됨이 아니다", () => {
    const workDays = [localDay(start + dayMs)];
    const later = start + 31 * dayMs;
    expect(age(thing({ pinned: true }), defaultCare, workDays, later).stale).toBe(false);
    expect(age(thing({ missing: true }), defaultCare, workDays, later).stale).toBe(false);
    expect(age(thing({ lastModified: start + 2 * dayMs }), defaultCare, workDays, later).stale).toBe(false);
  });

  it("정리 후보는 상자 밖 오래된 물건이고(바닥에 놓지 않았던 것도), 큰 파일이 먼저다", () => {
    const small = thing({ size: 10 });
    const large = thing({ size: 1000 });
    const middle = thing({ size: 100 });
    const ordered = sweepCandidates(room([small, large, middle], { workDays: [localDay(start + dayMs)] }), start + 31 * dayMs);
    expect(ordered.map((item) => item.id)).toEqual([large.id, middle.id, small.id]);
    const fallen = thing();
    const onShelf = thing({ spot: null });
    const boxed = thing({ box: { state: "virtual", fromPath: "참고/a.png", boxPath: "참고/a.png", at: start } });
    // 이번 주에 새로 들어와 아직 열지 않은 파일은 '새로 왔어요' 줄이라 후보가 아니에요.
    const justSeen = thing({ touchedAt: null, seenAt: start + 28 * dayMs });
    const candidates = sweepCandidates(room([fallen, onShelf, boxed, justSeen], { workDays: [localDay(start + dayMs), localDay(start + 25 * dayMs)] }), start + 31 * dayMs);
    expect(candidates.map((item) => item.id)).toEqual([fallen.id, onShelf.id]);
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

  it("방을 만들 때 넣은 손댄 때는 화면 날짜에서 빼고, 정리 판정에는 남긴다", () => {
    const made = buildRoom({ name: "방", source: "input", rootName: "방", files: [scanned("기획서.pdf", day(-15))], scan: sure, done: false, workDays: [], now: day(0) });
    const plan = made.things[0];
    expect(plan.touchedAt).toBe(day(0));
    expect(handTouchedAt(plan, made)).toBeNull();
    expect(relativeDay(shownActivity(plan, made), day(0))).toBe("15일 전");
    expect(lastActivity(plan)).toBe(day(0));
    // 방을 만든 뒤 실제로 손대면 그 날짜를 보여 줘요.
    expect(shownActivity({ ...plan, touchedAt: day(2) }, made)).toBe(day(2));
    // 함께 손댄 것으로 친 파일끼리는 고친 날 순서예요.
    const both = buildRoom({ name: "방", source: "input", rootName: "방", files: [scanned("옛.pdf", day(-15)), scanned("새.pdf", day(-6))], scan: sure, done: false, workDays: [], now: day(0) });
    expect([...both.things].sort(laneOrder.use).map((item) => item.name)).toEqual(["새.pdf", "옛.pdf"]);
  });

  it("방 밖에서 쓰면 그때부터 다시 세고, 그 뒤로 방을 쓴 날이 있어야 오래됨이다", () => {
    const item = thing({ lastUsedAt: day(5) });
    const workDays = [localDay(day(1)), localDay(day(6))];
    expect(age(item, defaultCare, workDays, day(7))).toEqual({ stale: false, days: 2 });
    expect(age(item, defaultCare, workDays, day(35))).toEqual({ stale: true, days: 30 });
    // 마지막 활동 날이나 그 전에만 방을 썼으면 오래돼도 그대로입니다.
    expect(age(item, defaultCare, [localDay(day(1)), localDay(day(5))], day(60))).toEqual({ stale: false, days: 55 });
    // 고친 날도 같은 기준입니다.
    expect(age(thing({ lastModified: day(2) }), defaultCare, [localDay(day(3))], day(32))).toEqual({ stale: true, days: 30 });
    // 방에서 손대지 않은 파일도 같은 기준이고, 처음 본 날이 아니라 실제 날짜로 세요(잠잠해요 줄과 같아요).
    expect(age(thing({ touchedAt: null, lastUsedAt: day(1) }), defaultCare, workDays, day(60))).toEqual({ stale: true, days: 59 });
    expect(age(thing({ touchedAt: null, lastModified: day(1), seenAt: day(40) }), defaultCare, [localDay(day(45))], day(60))).toEqual({ stale: true, days: 59 });
  });

  it("오래된 폴더로 방을 막 만들면 오래 쉰 파일은 바로 잠잠해요에 보이고, 주간 정리도 같은 파일을 물어요", () => {
    const made = day(100);
    const r = room([], { createdAt: made, workDays: [localDay(made)] });
    const old = thing({ touchedAt: null, seenAt: made, lastModified: day(0) });
    expect(laneOf(old, r, made + dayMs)).toBe("quiet");
    expect(thingAge(old, r, made + dayMs).stale).toBe(true);
    expect(laneOf(thing({ touchedAt: null, seenAt: made, lastModified: day(95) }), r, made + dayMs)).toBe("use");
  });
  it("줄 안 순서: 요즘 써요는 최근 것, 잠잠해요는 오래 쉰 것부터", () => {
    const things = [thing({ id: "a", touchedAt: day(3) }), thing({ id: "b", touchedAt: day(9) }), thing({ id: "c", touchedAt: day(1) })];
    expect([...things].sort(laneOrder.use).map((item) => item.id)).toEqual(["b", "a", "c"]);
    expect([...things].sort(laneOrder.quiet).map((item) => item.id)).toEqual(["c", "a", "b"]);
  });
  it("방 안 네 줄: 새로 왔어요 → 요즘 써요 → 잠잠해요 → 정리 상자", () => {
    const r = room([], { workDays: [localDay(day(1)), localDay(day(45))] });
    const now = day(50);
    // 방을 만든 뒤에 들어와 아직 열지 않은, 7일 안의 파일만 새 파일이에요.
    expect(laneOf(thing({ touchedAt: null, seenAt: day(48) }), r, now)).toBe("new");
    expect(laneOf(thing({ touchedAt: day(49), seenAt: day(48) }), r, now)).toBe("use");
    expect(laneOf(thing({ touchedAt: null, seenAt: start, lastModified: day(49) }), r, now)).toBe("use");
    // 줄은 실제 날짜로 나눠요. 방을 만든 뒤 처음 봤어도 고친 지 오래면 잠잠해요이고, 주간 정리 후보도 돼요.
    expect(laneOf(thing({ touchedAt: null, seenAt: day(40) }), r, now)).toBe("quiet");
    expect(thingAge(thing({ touchedAt: null, seenAt: day(40) }), r, now).stale).toBe(true);
    // 새로 왔어요 줄의 파일은 고친 날이 오래돼도 후보가 아니에요.
    expect(thingAge(thing({ touchedAt: null, seenAt: day(48) }), r, now).stale).toBe(false);
    // 홈에서 뺀 방은 잠잠해요로 보내지 않아요.
    expect(laneOf(thing({ touchedAt: day(2) }), { ...r, care: { ...r.care, done: true } }, now)).toBe("use");
    expect(laneOf(thing({ touchedAt: day(2) }), r, now)).toBe("quiet");
    expect(laneOf(thing({ touchedAt: day(2), pinned: true }), r, now)).toBe("use");
    expect(laneOf(thing({ touchedAt: day(2), box: { state: "virtual", fromPath: "a", boxPath: "a", at: day(3) } }), r, now)).toBe("box");
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
    const built = buildRoom({ name: "방", source: "input", rootName: "방", files: [scanned("a", day(1), day(2))], scan: sure, done: false, workDays: [], now: day(4) });
    expect(built.workDays).toEqual([localDay(day(1)), localDay(day(2))]);
    expect(built.things[0].lastUsedAt).toBe(day(2));
  });

  it("다 읽지 못한 큰 방에서 방을 만들기 전 파일이 이제야 읽히면 새 파일로 치지 않아요", () => {
    const partial = { complete: false, failed: 0 };
    const files = [scanned("옛 결과물.pdf", start - 5000), scanned("오늘 받은.pdf", start + 1000)];
    expect(newFileCount(room([]), files, partial)).toBe(1);
    expect(newFileCount(room([]), files, sure)).toBe(2);
    const merged = mergeScan(room([]), files, partial, start + 2000);
    expect(merged.things.map((item) => laneOf(item, merged, start + 3000))).toEqual(["use", "new"]);
    expect(mergeScan(room([]), files, sure, start + 2000).things.map((item) => item.seenAt)).toEqual([start + 2000, start + 2000]);
  });

  it("다른 파일을 밖에서 쓴 날이 있으면 그대로인 물건은 오래됨이 된다", () => {
    const still = thing({ path: "a" });
    const next = mergeScan(room([still]), [scanned("a", 0), scanned("b", day(4), day(5))], sure, day(8));
    expect(age(next.things[0], defaultCare, next.workDays, day(40)).stale).toBe(true);
  });

  it("아무도 쓰지 않은 방은 오래됨으로 세지 않는다: 활동이 없거나, 모든 파일의 마지막 활동이 같은 옛날 하루여도", () => {
    const untouched = mergeScan(room([thing({ path: "a" })]), [scanned("a", 0)], sure, day(30));
    expect(untouched.workDays).toEqual([]);
    expect(staleCount(untouched, day(30))).toBe(0);

    const old = room([thing({ path: "a", touchedAt: day(-10) }), thing({ path: "b", touchedAt: day(-10) })]);
    const scanOnly = mergeScan(old, [scanned("a", day(0), day(0) + 1000), scanned("b", day(-3), day(0))], sure, day(20));
    expect(scanOnly.workDays).toEqual([localDay(day(-3)), localDay(day(0))]);
    expect(staleCount(scanOnly, day(20))).toBe(0);

    const files = [scanned("a", day(0)), scanned("b", day(0), day(0))];
    const built = buildRoom({ name: "방", source: "input", rootName: "방", files, scan: sure, done: false, workDays: [], now: day(20) });
    const again = mergeScan(built, files, sure, day(50));
    expect(staleCount(again, day(50))).toBe(0);
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

  it("상자 폴더에서 처음 보는 파일은 상자에 든 파일이고, 상자에서 비운 파일은 기록도 빠진다", () => {
    const found = mergeScan(room([]), [file("_Folduct 정리상자/참고/b.png"), file("a.png")], { complete: true, failed: 0 }, start);
    expect(found.things.find((item) => item.path === "a.png")?.box).toBeNull();
    const inBox = found.things.find((item) => item.path.startsWith("_Folduct"))!;
    expect(inBox.box).toEqual({ state: "boxed", fromPath: "참고/b.png", boxPath: "_Folduct 정리상자/참고/b.png", at: start });
    expect(laneOf(inBox, found, start)).toBe("box");
    expect(newFileCount(room([]), [file("_Folduct 정리상자/b.png"), file("a.png")], { complete: true, failed: 0 })).toBe(1);

    const emptied = mergeScan(found, [file("a.png")], { complete: true, failed: 0 }, start);
    expect(emptied.things.map((item) => item.path)).toEqual(["a.png"]);
    // 다 못 읽은 스캔에서는 상자 기록을 지우지 않아요.
    expect(mergeScan(found, [file("a.png")], { complete: false, failed: 0 }, start).things).toHaveLength(2);
  });

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

  describe("Finder에서 이름을 바꾸거나 옮긴 파일", () => {
    const sure = { complete: true, failed: 0 };
    const at = (path: string, size = 100, lastModified = 50): ScannedFile => ({ path, name: path.split("/").pop()!, kind: kindOf(path), size, lastModified });

    it("크기와 고친 시각이 하나로 맞으면 같은 물건으로 잇고 자리·고정·메모를 지킨다", () => {
      const cover = thing({ path: "표지.png", name: "표지.png", size: 100, lastModified: 50, pinned: true, note: "표지" });
      const data = thing({ path: "데이터.csv", name: "데이터.csv", kind: "table", size: 200, lastModified: 60 });
      const files = [at("표지-새이름.png"), at("참고/데이터.csv", 200, 60)];
      const next = mergeScan(room([cover, data]), files, sure, start);
      expect(next.things).toHaveLength(2);
      expect(next.things.find((item) => item.id === cover.id)).toMatchObject({ path: "표지-새이름.png", name: "표지-새이름.png", spot: cover.spot, pinned: true, note: "표지", missing: false });
      expect(next.things.find((item) => item.id === data.id)).toMatchObject({ path: "참고/데이터.csv", missing: false });
      expect(newFileCount(room([cover, data]), files, sure)).toBe(0);
    });

    it("짝이 둘 이상이거나, 다 읽지 못했거나, 빈 파일이면 잇지 않는다", () => {
      const twins = [thing({ path: "a.png", size: 100, lastModified: 50 }), thing({ path: "b.png", size: 100, lastModified: 50 })];
      const both = mergeScan(room(twins), [at("c.png"), at("d.png")], sure, start);
      expect(both.things.filter((item) => item.missing)).toHaveLength(2);
      expect(both.things).toHaveLength(4);

      const one = thing({ path: "a.png", size: 100, lastModified: 50 });
      expect(mergeScan(room([one]), [at("c.png")], { complete: false, failed: 0 }, start).things).toHaveLength(2);
      expect(mergeScan(room([one]), [at("c.png")], { complete: true, failed: 1 }, start).things).toHaveLength(2);

      const empty = thing({ path: "빈.txt", size: 0, lastModified: 50 });
      expect(mergeScan(room([empty]), [at("새.txt", 0)], sure, start).things.find((item) => item.id === empty.id)?.missing).toBe(true);
    });

    it("상자에 든 물건과 상자 폴더의 파일은 잇지 않는다", () => {
      const loose = thing({ path: "a.png", size: 100, lastModified: 50 });
      const next = mergeScan(room([loose]), [at("_Folduct 정리상자/a (2).png")], sure, start);
      expect(next.things.find((item) => item.id === loose.id)?.missing).toBe(true);
    });
  });

  it("폴더 겹침은 지금 있는(없어지지도 상자에 들지도 않은) 물건만 센다", () => {
    const things = [thing({ path: "a.png" }), thing({ path: "b.png" }), thing({ path: "c.png", missing: true }), thing({ path: "d.png", box: { state: "virtual", fromPath: "d.png", boxPath: "d.png", at: start } })];
    expect(scanOverlap(room(things), [file("a.png"), file("c.png"), file("d.png"), file("new.png")])).toEqual({ kept: 1, total: 2 });
  });
});

describe("새 파일 알림", () => {
  it("방이 모르는 파일만 세고, 상자로 옮긴 파일의 두 자리는 세지 않는다", () => {
    const boxed = thing({ path: "_Folduct 정리상자/b", box: { state: "boxed", fromPath: "b", boxPath: "_Folduct 정리상자/b", at: 0 } as Thing["box"] });
    const known = room([thing({ path: "a" }), boxed]);
    const at = (path: string): ScannedFile => ({ path, name: path, kind: "text", size: 1, lastModified: 0 });
    const scan = { complete: true, failed: 0 };
    expect(newFileCount(known, ["a", "b", "_Folduct 정리상자/b"].map(at), scan)).toBe(0);
    expect(newFileCount(known, ["a", "새 파일", "새 폴더/또 하나"].map(at), scan)).toBe(2);
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
    expect(result.files.map((file) => [file.path, file.kind, file.size])).toEqual([["메모.md", "text", 3], ["영상/a.mov", "video", GB]]);
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
  it("같은 폴더 안에서 이름만 바꾸고, 겹치는 이름·다른 폴더·상자 안 파일은 거절한다", async () => {
    const raw = seed();
    const root = view(raw);
    expect(await renameFile(root, "참고/시안.psd", "최종 시안.psd")).toEqual({ ok: true });
    expect(await fileExists(root, "참고/최종 시안.psd")).toBe(true);
    expect(await fileExists(root, "참고/시안.psd")).toBe(false);
    expect(await renameFile(root, "참고/최종 시안.psd", "최종 시안.psd")).toEqual({ ok: true });
    await moveFile(root, "참고/최종 시안.psd", "_Folduct 정리상자/참고/최종 시안.psd");
    expect(await renameFile(root, "_Folduct 정리상자/참고/최종 시안.psd", "다른.psd")).toMatchObject({ ok: false, reason: "invalid" });
    expect(await renameFile(root, "참고/없음.psd", "b/c.psd")).toMatchObject({ ok: false, reason: "invalid" });
    expect(await renameFile(root, "참고/없음.psd", "")).toMatchObject({ ok: false, reason: "invalid" });
    expect(await renameFile(root, "참고/없음.psd", "새.psd")).toMatchObject({ ok: false, reason: "missing" });
    // 점으로 시작하거나 시스템 파일 이름이면 다음에 읽을 때 목록에서 빠지니 거절해요.
    expect(await renameFile(view(seed({ "a.txt": "1" })), "a.txt", ".a.txt")).toMatchObject({ ok: false, reason: "invalid" });
    expect(await renameFile(view(seed({ "a.txt": "1" })), "a.txt", "Thumbs.db")).toMatchObject({ ok: false, reason: "invalid" });
    const two = view(seed({ "a.txt": "1", "b.txt": "2" }));
    expect(await renameFile(two, "a.txt", "b.txt")).toMatchObject({ ok: false, reason: "occupied" });
    expect(await fileExists(two, "a.txt")).toBe(true);
  });
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
    // 한 묶음에서 이미 잡은 이름은 디스크에 없어도 피해요(boxRoom이 쓰는 방식).
    const reserved = new Set<string>();
    expect(await freeBoxPath(root, "참고/새.psd", reserved)).toBe("_Folduct 정리상자/참고/새.psd");
    expect(await freeBoxPath(root, "참고/새.psd", reserved)).toBe("_Folduct 정리상자/참고/새 (2).psd");
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

  it("파일 별은 방 고리 밖에 뜨고, 오래된 파일은 더 멀리 있으며, 상자 속 파일은 뜨지 않는다", () => {
    const workDays = [localDay(start + dayMs)];
    const fresh = thing({ touchedAt: start + 40 * dayMs });
    const fallen = thing();
    const boxed = thing({ box: { state: "virtual", fromPath: "a", boxPath: "a", at: start } });
    const r = room([fresh, fallen, boxed], { workDays });
    const center = roomSpots(3)[1];
    const stars = roomStars(r, center, clusterSpread(3), start + 40 * dayMs);
    expect(stars.map((star) => star.thing.id)).toEqual([fresh.id, fallen.id]);
    const distance = (id: string) => {
      const star = stars.find((item) => item.thing.id === id)!;
      return Math.hypot(star.x - center.x, (star.y - center.y) / 0.8);
    };
    expect(stars.find((star) => star.thing.id === fallen.id)?.stale).toBe(true);
    expect(distance(fresh.id)).toBeGreaterThan(roomRadius(r) + 7);
    expect(distance(fallen.id)).toBeGreaterThan(distance(fresh.id));
  });

  it("형식별 용량은 없어진 파일을 빼고 묶인다", () => {
    const parts = kindParts([thing({ kind: "image", size: 30 }), thing({ kind: "video", size: 10 }), thing({ kind: "pdf", size: 60, missing: true })]);
    expect(parts.map((part) => [part.label, part.size])).toEqual([["이미지", 30], ["영상", 10]]);
  });

  it("파일은 커진 주름관과 이름표 자리를 피해 뜬다", () => {
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
    const built = buildRoom({ name: "x", source: "input", rootName: "x", files: [], scan: parsed.rooms[0], done: false, workDays: [], now: start });
    expect(Object.keys(built.scan).sort()).toEqual(["at", "complete", "failed", "freedBytes"]);
  });

  it("60일 넘게 고친 파일이 없으면 완료로 보고, 새 방은 최근 파일 6개만 바닥에 놓는다", () => {
    const files = Array.from({ length: 9 }, (_, i) => ({ path: `f${i}.txt`, name: `f${i}.txt`, kind: "text" as const, size: 1, lastModified: start - i * dayMs }));
    expect(looksDone(files, start + 10 * dayMs)).toBe(false);
    expect(looksDone(files, start + 61 * dayMs)).toBe(true);
    expect(looksDone([], start)).toBe(true);
    const built = buildRoom({ name: "방", source: "input", rootName: "방", origin: "/Users/me/방", files, scan: { complete: true, failed: 0 }, done: true, workDays: [], now: start });
    expect(built.things.filter((item) => item.spot).map((item) => item.path).sort()).toEqual(["f0.txt", "f1.txt", "f2.txt", "f3.txt", "f4.txt", "f5.txt"]);
    expect(built.care.done).toBe(true);
    expect(built.origin).toBe("/Users/me/방");
  });
});

describe("오래 안 쓴 방 제안", () => {
  const at = (days: number) => start + days * dayMs;

  it("방 전체를 60일 넘게 안 쓰면 묻는다", () => {
    expect(doneOfferDue(room([thing()]), at(60))).toBe(false);
    expect(doneOfferDue(room([thing()]), at(61))).toBe(true);
  });

  it("한 파일이라도 최근에 썼으면 묻지 않는다", () => {
    expect(doneOfferDue(room([thing(), thing({ lastUsedAt: at(50) })]), at(61))).toBe(false);
  });

  it("상자에 든 파일이나 없어진 파일은 활동으로 치지 않는다", () => {
    const boxed = thing({ touchedAt: at(60), box: { state: "virtual", fromPath: "a", boxPath: "a", at: at(60) } });
    const gone = thing({ touchedAt: at(60), missing: true });
    expect(doneOfferDue(room([thing(), boxed, gone]), at(61))).toBe(true);
  });

  it("빈 방과 완료한 방은 묻지 않는다", () => {
    expect(doneOfferDue(room([]), at(90))).toBe(false);
    expect(doneOfferDue(room([thing()], { care: { ...defaultCare, done: true } }), at(90))).toBe(false);
  });

  it("답한 뒤에는 다시 묻지 않고, 방을 다시 쓴 뒤 또 60일이 지나면 묻는다", () => {
    expect(doneOfferDue(room([thing()], { doneOfferAt: at(61) }), at(200))).toBe(false);
    expect(doneOfferDue(room([thing({ touchedAt: at(100) })], { doneOfferAt: at(61) }), at(161))).toBe(true);
  });
});

describe("예전 돌보기 설정 옮기기", () => {
  it("저장한 적이 없으면 기본값이다", () => {
    expect(normalizeCare(undefined)).toEqual(defaultCare);
    expect(defaultCare.staleAfterDays).toBe(30);
  });

  it("예전 기본값 7일은 30일로 올리고, 옛 칸은 남기지 않는다", () => {
    const old = { enabled: true, resting: false, done: false, tiltAfterDays: 3, fallAfterDays: 7 };
    expect(normalizeCare(old)).toEqual({ done: false, staleAfterDays: 30 });
  });

  it("직접 정한 쓰러짐 일수와 완료는 지키고, 없어진 잠시 쉼과 제안 끄기는 버린다", () => {
    expect(normalizeCare({ enabled: false, resting: true, done: true, fallAfterDays: 14 } as Parameters<typeof normalizeCare>[0])).toEqual({ done: true, staleAfterDays: 14 });
  });

  it("새 기준이 있으면 옛 값은 보지 않는다", () => {
    expect(normalizeCare({ staleAfterDays: 45, fallAfterDays: 14 }).staleAfterDays).toBe(45);
  });

  it("망가진 옛 값은 기본값으로 둔다", () => {
    expect(normalizeCare({ fallAfterDays: "어제" }).staleAfterDays).toBe(30);
    expect(normalizeCare({ fallAfterDays: 0 }).staleAfterDays).toBe(30);
  });
});

describe("완료한 프로젝트", () => {
  it("오래됨으로 세지 않고, 주간 정리 후보도 없지만 다시 진행 중으로 돌리면 돌아온다", () => {
    const done = { ...defaultCare, done: true };
    const workDays = [localDay(start + dayMs)];
    expect(age(thing(), done, workDays, start + 31 * dayMs).stale).toBe(false);
    expect(age(thing(), defaultCare, workDays, start + 31 * dayMs).stale).toBe(true);
    const finished = room([thing({ size: 6 * GB })], { care: done, workDays });
    expect(sweepCandidates(finished, start + 31 * dayMs)).toEqual([]);
  });

  it("자리가 모자라면 방금 고른 방을 앞세우고, 나머지는 최근에 쓴 순서로 고른다", () => {
    const used = (id: string, at: number) => room([thing({ id: `${id}-f`, path: `${id}.txt`, touchedAt: at })], { id });
    const rooms = [used("옛날", start), ...Array.from({ length: homeLimit }, (_, i) => used(`r${i}`, start + (i + 1) * dayMs))];
    expect(roomsToKeep(rooms, [null, null])).toHaveLength(homeLimit);
    expect(roomsToKeep(rooms, [null, null])).not.toContain("옛날");
    const picked = roomsToKeep(rooms, ["옛날", null]);
    expect(picked).toHaveLength(homeLimit);
    expect(picked).toContain("옛날");
    expect(picked).not.toContain("r0");
  });

  it("샘플은 날짜가 최근이어도 내 방보다 나중에 고른다", () => {
    const used = (id: string, at: number, source: Room["source"]) => room([thing({ id: `${id}-f`, path: `${id}.txt`, touchedAt: at })], { id, source });
    const samples = Array.from({ length: 3 }, (_, i) => used(`s${i}`, start + 30 * dayMs, "sample"));
    const mine = Array.from({ length: 3 }, (_, i) => used(`m${i}`, start + i * dayMs, "input"));
    const picked = roomsToKeep([...samples, ...mine], [null, null]);
    expect(picked.slice(0, 3).sort()).toEqual(["m0", "m1", "m2"]);
    expect(roomsToKeep([...samples, ...mine], ["s2", null])[0]).toBe("s2");
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
