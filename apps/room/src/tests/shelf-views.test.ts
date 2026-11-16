import { describe, expect, it } from "vitest";
import { emptyShelfViews, normalizeShelfViews, parseExts, uniqueName } from "../domain/shelfViews";

describe("서랍장 구성", () => {
  it("없거나 깨진 값은 기본 형식별 서랍으로 돌아가요", () => {
    expect(normalizeShelfViews(undefined)).toEqual(emptyShelfViews);
    expect(normalizeShelfViews("x")).toEqual(emptyShelfViews);
    expect(normalizeShelfViews({ kind: "x", custom: 3 })).toEqual(emptyShelfViews);
  });
  it("서랍 이름을 다듬고 겹치면 숫자를 붙이며, 모르는 형식은 빼요", () => {
    const views = normalizeShelfViews({
      kind: [{ id: "a", name: "  사진  ", kinds: ["image", "nope", "image"] }, { id: "b", name: "사진", kinds: ["pdf"] }, { name: "", kinds: "image" }, null],
      custom: [],
    });
    expect(views.kind).toEqual([
      { id: "a", name: "사진", kinds: ["image"] },
      { id: "b", name: "사진 2", kinds: ["pdf"] },
      { id: "drawer-2", name: "서랍", kinds: [] },
    ]);
  });
  it("새 서랍장은 형식별·컬러별과 이름이 겹치지 않고, 그 id도 쓰지 않아요", () => {
    const views = normalizeShelfViews({ custom: [{ id: "kind", name: "형식별", drawers: [{ id: "d", name: "수업", kinds: ["slides"] }] }, { id: "v2", name: "x".repeat(40) }] });
    expect(views.kind).toBeNull();
    expect(views.custom).toEqual([
      { id: "view-0", name: "형식별 2", drawers: [{ id: "d", name: "수업", kinds: ["slides"] }] },
      { id: "v2", name: "x".repeat(20), drawers: [] },
    ]);
  });
  it("이름이 비어 있지 않으면 그대로, 겹치면 다음 숫자예요", () => {
    expect(uniqueName("서랍", [])).toBe("서랍");
    expect(uniqueName("서랍", ["서랍", "서랍 2"])).toBe("서랍 3");
  });
});

describe("서랍 조건", () => {
  it("확장자는 점·대소문자·띄어쓰기를 다듬고, 크기·길이는 양수만 남겨요", () => {
    const [drawer] = normalizeShelfViews({ kind: [{ id: "a", name: "코드", kinds: [], exts: ".TS, tsx  py tsx 한글", minMB: 0, maxMB: 0.004, minMin: -1, maxMin: "3" }] }).kind!;
    expect(drawer).toEqual({ id: "a", name: "코드", kinds: [], exts: ["ts", "tsx", "py"], maxMB: 0.004 });
    expect(parseExts(["MP4", "..mov", 3])).toEqual(["mp4", "mov"]);
  });
});
