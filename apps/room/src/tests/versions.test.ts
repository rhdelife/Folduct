import { describe, expect, it } from "vitest";
import type { Thing } from "../domain/model";
import { groupVersions, versionStem } from "../domain/versions";

const thing = (path: string, lastModified: number, over: Partial<Thing> = {}): Thing => ({ id: path, path, name: path.split("/").pop()!, kind: "image", size: 1, lastModified, lastUsedAt: null, missing: false, spot: null, note: "", touchedAt: null, seenAt: 0, pinned: false, box: null, ...over });

describe("버전 줄기", () => {
  it("최종·최최종·버전 번호·복사본 꼬리를 떼요", () => {
    for (const name of ["포스터.png", "포스터_v2.png", "포스터_최종.png", "포스터최최최종.png", "포스터_최최종 (1).png", "포스터 진짜최종.png", "포스터_final.png", "포스터-final2.png", "포스터 copy 2.png", "포스터_수정본.png", "포스터_최종_v3.png", "포스터_251103.png", "포스터 2.png"]) {
      expect(versionStem(name)).toBe("포스터");
    }
  });
  it("풀어쓴 한글과 대문자도 같은 줄기예요", () => {
    expect(versionStem("포스터_최종.PNG".normalize("NFD"))).toBe("포스터");
    expect(versionStem("Logo_V2.svg")).toBe("logo");
  });
  it("숫자만 붙은 꼬리와 낱말 속 글자는 그대로 둬요", () => {
    expect(versionStem("slide-1.png")).toBe("slide-1");
    expect(versionStem("1장.md")).toBe("1장");
    expect(versionStem("nav2.png")).toBe("nav2");
    expect(versionStem("KakaoTalk_20251103_142233123.jpg")).toBe("kakaotalk_20251103_142233123");
  });
  it("가운데 있는 버전 번호에서 잘라요", () => {
    expect(versionStem("spatial_archive_idea_presentation_v7_6slides.pptx")).toBe("spatial_archive_idea_presentation");
    expect(versionStem("spatial_archive_idea_presentation_v1.pptx")).toBe("spatial_archive_idea_presentation");
    expect(versionStem("last-supper-composition-v2-renaissance.png")).toBe("last-supper-composition");
    expect(versionStem("last-supper-composition.png")).toBe("last-supper-composition");
  });
});

describe("버전 묶기", () => {
  it("같은 폴더·같은 형식만 묶고 새것부터 둬요", () => {
    const groups = groupVersions([thing("a/포스터.png", 1), thing("a/포스터_최종.png", 3), thing("a/포스터_v2.png", 2), thing("b/포스터_최종.png", 9), thing("a/포스터_최종.pdf", 5, { kind: "pdf" }), thing("a/로고.png", 4)]);
    expect([...groups.values()].map((list) => list.map((item) => item.path))).toEqual([["a/포스터_최종.png", "a/포스터_v2.png", "a/포스터.png"]]);
  });
  it("버전 번호가 붙은 형제 폴더의 같은 이름 파일을 묶어요", () => {
    const groups = groupVersions([
      thing("output/comic/01-talks.png", 1),
      thing("output/comic-rough-marker-v2/01-talks.png", 2),
      thing("output/comic-final-style-v4/01-talks.png", 4),
      thing("output/comic-final-style-v4/02-reveal.png", 4),
      thing("output/other/01-talks.png", 9),
      thing("deck-v1/a.pptx", 1, { kind: "slides" }),
      thing("deck-v2/a.pptx", 2, { kind: "slides" }),
    ]);
    expect([...groups.values()].map((list) => list.map((item) => item.path))).toEqual([
      ["output/comic-final-style-v4/01-talks.png", "output/comic-rough-marker-v2/01-talks.png", "output/comic/01-talks.png"],
      ["deck-v2/a.pptx", "deck-v1/a.pptx"],
    ]);
  });
  it("상자에 든 파일은 묶지 않아요", () => {
    const box = { fromPath: "a/포스터.png" } as unknown as Thing["box"];
    expect(groupVersions([thing("a/포스터.png", 1, { box }), thing("a/포스터_최종.png", 2)]).size).toBe(0);
  });
});
