import { describe, expect, it } from "vitest";
import type { Room, Thing } from "../domain/model";
import { drawerShelves, drawerStats, extCounts, hueShelves, kindCounts, kindShelves, leftoverItems, secondsKey, shelfItems, sizeShelves, unreadHueShelf, videoLengthShelves } from "../domain/shelves";

const thing = (path: string, lastModified: number, over: Partial<Thing> = {}): Thing => ({ id: path, path, name: path.split("/").pop()!, kind: "image", size: 10, lastModified, lastUsedAt: null, missing: false, spot: null, note: "", touchedAt: null, seenAt: 0, pinned: false, box: null, ...over });
const room = (id: string, things: Thing[], done = false) => ({ id, name: id, things, care: { done, staleAfterDays: 14 } }) as unknown as Room;
const groups = [{ label: "이미지", kinds: ["image" as const] }, { label: "PDF·문서", kinds: ["pdf" as const, "office" as const] }, { label: "영상", kinds: ["video" as const] }];

describe("형식별 칸", () => {
  it("방을 가로질러 형식별로 새것부터 모으고, 빈 칸은 빼요", () => {
    const shelves = kindShelves([room("a", [thing("a/1.png", 1), thing("a/r.pdf", 5, { kind: "pdf" })]), room("b", [thing("b/2.png", 3), thing("b/d.docx", 2, { kind: "office" })])], groups);
    expect(shelves.map((shelf) => [shelf.label, shelf.items.map((item) => item.thing.path), shelf.size])).toEqual([
      ["이미지", ["b/2.png", "a/1.png"], 20],
      ["PDF·문서", ["a/r.pdf", "b/d.docx"], 20],
    ]);
  });
  it("홈에서 뺀 방, 상자·사라진 파일, 옛 버전은 빼요", () => {
    const box = { fromPath: "a/x.png" } as unknown as Thing["box"];
    const shelves = kindShelves([room("a", [thing("a/포스터.png", 1), thing("a/포스터_최종.png", 2), thing("a/x.png", 3, { box }), thing("a/y.png", 4, { missing: true })]), room("done", [thing("d/z.png", 9)], true)], groups);
    expect(shelves[0].items.map((item) => [item.thing.path, item.versions])).toEqual([["a/포스터_최종.png", 2]]);
  });
});

describe("컬러별 칸", () => {
  it("이미지를 색 순서대로 새것부터 모으고, 못 읽은 이미지와 빈 색은 빼요", () => {
    const items = shelfItems([room("a", [thing("a/1.png", 1), thing("a/2.png", 2), thing("a/3.png", 3)]), room("b", [thing("b/4.png", 4), thing("b/5.png", 5)])]);
    const found = new Map([["a/1.png", "파랑"], ["a/2.png", "빨강"], ["a/3.png", "파랑"], ["b/4.png", null]] as const);
    expect(hueShelves(items, new Map(found)).map((shelf) => [shelf.label, shelf.items.map((item) => item.thing.path)])).toEqual([
      ["빨강", ["a/2.png"]],
      ["파랑", ["a/3.png", "a/1.png"]],
    ]);
  });

  it("영상 썸네일 색은 이미지와 섞지 않고 읽지 못한 영상은 따로 보여 줘요", () => {
    const items = shelfItems([room("a", [
      thing("사진.png", 1), thing("영상.mp4", 2, { kind: "video" }),
      thing("실패.mov", 3, { kind: "video" }), thing("읽는중.mov", 4, { kind: "video" }),
    ])]);
    const found = new Map([["사진.png", "빨강"], ["영상.mp4", "빨강"], ["실패.mov", null]] as const);
    const shelves = [...hueShelves(items, found, "video"), ...unreadHueShelf(items, found, "video")];
    expect(shelves.map(({ label, items }) => [label, items.map(({ thing }) => thing.name)])).toEqual([
      ["빨강", ["영상.mp4"]], ["색 미확인", ["실패.mov"]],
    ]);
  });
});

describe("기본 범위 분류", () => {
  it("영상 길이의 경계를 다음 서랍에 넣고, 읽는 중과 읽을 수 없는 영상을 구분해요", () => {
    const items = shelfItems([room("a", [
      thing("짧음.mp4", 1, { kind: "video" }), thing("1분.mp4", 2, { kind: "video" }),
      thing("실패.mov", 3, { kind: "video" }), thing("읽는중.mov", 4, { kind: "video" }), thing("이미지.png", 5),
    ])]);
    const seconds = new Map([[secondsKey(items[0]), 59.9], [secondsKey(items[1]), 60], [secondsKey(items[2]), null], [secondsKey(items[4]), 60]]);
    expect(videoLengthShelves(items, seconds).map(({ label, items }) => [label, items.map(({ thing, durationSeconds }) => [thing.name, durationSeconds])])).toEqual([
      ["1분 미만", [["짧음.mp4", 59.9]]], ["1분 ~ 5분", [["1분.mp4", 60]]], ["길이 미확인", [["실패.mov", undefined]]],
    ]);
  });

  it("용량은 형식이나 연결 권한과 관계없이 파일을 한 구간에만 넣어요", () => {
    const mb = 1024 ** 2;
    const items = shelfItems([room("a", [
      thing("소형.png", 1, { size: mb - 1 }), thing("1MB.pdf", 2, { kind: "pdf", size: mb }),
      thing("100MB.mp4", 3, { kind: "video", size: 100 * mb }), thing("1GB.zip", 4, { kind: "archive", size: 1024 * mb }),
    ])]);
    expect(sizeShelves(items).map(({ items }) => items.map(({ thing }) => thing.name))).toEqual([["소형.png"], ["1MB.pdf"], ["100MB.mp4"], ["1GB.zip"]]);
  });
});

describe("사용자 서랍 조건", () => {
  const files = [
    thing("a/app.ts", 5, { kind: "text", size: 2 * 1024 }),
    thing("a/view.TSX", 4, { kind: "text", size: 8 * 1024 }),
    thing("a/run.py", 3, { kind: "text" }),
    thing("a/짧은.mp4", 2, { kind: "video", size: 20 * 1024 ** 2 }),
    thing("a/긴.mov", 1, { kind: "video", size: 900 * 1024 ** 2 }),
    thing("a/모름.webm", 0, { kind: "video" }),
  ];
  const rooms = [room("a", files)];
  const items = shelfItems(rooms);
  const seconds = new Map(items.filter((item) => item.thing.kind === "video").map((item) => [secondsKey(item), item.thing.name.startsWith("짧은") ? 45 : item.thing.name.startsWith("긴") ? 1800 : null]));
  it("확장자·크기·영상 길이 조건이 모두 맞는 파일만 담고, 길이를 모르는 영상은 빼요", () => {
    const shelves = drawerShelves(rooms, [
      { id: "1", name: "타입스크립트", kinds: [], exts: ["ts", "tsx"] },
      { id: "2", name: "작은 코드", kinds: ["text"], maxMB: 0.005 },
      { id: "3", name: "1분 안 영상", kinds: ["video"], maxMin: 1 },
      { id: "4", name: "10분 넘는 영상", kinds: ["video"], minMin: 10, minMB: 100 },
      { id: "5", name: "빈 서랍", kinds: [] },
    ], seconds);
    expect(shelves.map((shelf) => [shelf.label, shelf.kinds, shelf.items.map((item) => item.thing.name)])).toEqual([
      ["타입스크립트", ["text"], ["app.ts", "view.TSX"]],
      ["작은 코드", ["text"], ["app.ts", "run.py"]],
      ["1분 안 영상", ["video"], ["짧은.mp4"]],
      ["10분 넘는 영상", ["video"], ["긴.mov"]],
    ]);
  });
});

describe("서랍장 편집 창 셈", () => {
  const items = shelfItems([room("a", [thing("a/app.ts", 5, { kind: "text", size: 2 }), thing("a/b.ts", 4, { kind: "text", size: 3 }), thing("a/c.md", 3, { kind: "text", size: 4 }), thing("a/p.png", 2, { size: 10 })])]);
  const none = new Map<string, number | null>();
  it("서랍마다 담길 개수와 크기, 어디에도 없는 파일을 셈해요", () => {
    const code = { id: "c", name: "코드", kinds: ["text" as const], exts: ["ts"] };
    expect(drawerStats(code, items, none)).toEqual({ count: 2, size: 5 });
    expect(leftoverItems([code], items, none).map((item) => item.thing.name)).toEqual(["c.md", "p.png"]);
    expect(drawerStats({ id: "e", name: "빈", kinds: [] }, items, none)).toEqual({ count: 0, size: 0 });
  });
  it("형식별 개수와 고른 형식 안의 확장자를 많은 것부터 세요", () => {
    expect(kindCounts(items).get("text")).toBe(3);
    expect(extCounts(items, ["text"])).toEqual([["ts", 2], ["md", 1]]);
    expect(extCounts(items, []).map(([ext]) => ext)).toEqual(["ts", "md", "png"]);
  });
});
