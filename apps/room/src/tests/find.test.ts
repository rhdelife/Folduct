import { describe, expect, it } from "vitest";
import { matchesName } from "../domain/model";
import type { Thing } from "../domain/model";
import { canThumb, coverOf } from "../storage/thumbs";

describe("방 안 이름 찾기", () => {
  it("대소문자와 풀어쓴 한글을 가리지 않아요", () => {
    expect(matchesName("Concept-Poster.PNG", "poster")).toBe(true);
    expect(matchesName("포스터_최종.png".normalize("NFD"), "최종")).toBe(true);
  });
  it("빈칸으로 나눈 낱말이 모두 있어야 맞아요", () => {
    expect(matchesName("camp-logo-v2.svg", "logo v2")).toBe(true);
    expect(matchesName("camp-logo-v2.svg", "logo v3")).toBe(false);
  });
  it("빈 검색어는 모두 맞아요", () => {
    expect(matchesName("a.png", "  ")).toBe(true);
  });
});

describe("미리보기를 읽을 파일", () => {
  const image = { kind: "image" as const, name: "a.png", size: 1000, missing: false };
  it("화면이 그릴 수 있는 이미지만 읽어요", () => {
    expect(canThumb(image)).toBe(true);
    expect(canThumb({ ...image, name: "a.CR2" })).toBe(false);
    expect(canThumb({ ...image, kind: "pdf", name: "a.pdf" })).toBe(false);
    expect(canThumb({ ...image, missing: true })).toBe(false);
    expect(canThumb({ ...image, size: 41 * 1024 ** 2 })).toBe(false);
  });
});

describe("방의 대표 이미지", () => {
  const thing = (id: string, over: Partial<Thing> = {}): Thing => ({ id, path: `${id}.png`, name: `${id}.png`, kind: "image", size: 1000, lastModified: 0, lastUsedAt: null, missing: false, spot: null, note: "", touchedAt: null, seenAt: 0, pinned: false, box: null, ...over });
  it("가장 최근에 고친 이미지를 골라요", () => {
    expect(coverOf({ things: [thing("old", { lastModified: 1 }), thing("new", { lastModified: 9 }), thing("doc", { kind: "pdf", name: "doc.pdf", lastModified: 20 })] })?.id).toBe("new");
  });
  it("고정한 이미지가 있으면 그게 먼저예요", () => {
    expect(coverOf({ things: [thing("new", { lastModified: 9 }), thing("pin", { lastModified: 1, pinned: true })] })?.id).toBe("pin");
  });
  it("상자에 든 파일과 사라진 파일은 빼고, 없으면 null이에요", () => {
    const box = { from: "a.png", at: 0 } as unknown as Thing["box"];
    expect(coverOf({ things: [thing("boxed", { lastModified: 9, box }), thing("gone", { missing: true })] })).toBeNull();
  });
});
