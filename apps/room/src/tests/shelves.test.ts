import { describe, expect, it } from "vitest";
import type { Room, Thing } from "../domain/model";
import { kindShelves } from "../domain/shelves";

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
