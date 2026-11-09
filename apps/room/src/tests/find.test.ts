import { describe, expect, it } from "vitest";
import { matchesName } from "../domain/model";
import { canThumb } from "../storage/thumbs";

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
