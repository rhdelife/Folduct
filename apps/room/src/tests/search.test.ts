import { describe, expect, it } from "vitest";
import { isSearching, matchesPath, searchOrder } from "../domain/search";
import { kindOf, type Thing } from "../domain/model";

const thing = (path: string, size = 1): Thing => {
  const name = path.split("/").pop()!;
  return { id: path, path, name, kind: kindOf(name), size, lastModified: 0, lastUsedAt: null, missing: false, spot: null, note: "", touchedAt: null, seenAt: 0, pinned: false, box: null };
};

// 실제 렌더링이론 폴더 경로로 확인해요.
describe("방 안 찾기(경로)", () => {
  it("폴더 이름으로도 찾아요", () => {
    expect(matchesPath(thing("tmp/pdfs/rt89/page-001.png"), "rt89")).toBe(true);
    expect(matchesPath(thing("tmp/pdfs/calculation_pack/equations/eq-12.png"), "calculation eq-12")).toBe(true);
    expect(matchesPath(thing("RT4_시험대비_강의노트.pdf"), "rt89")).toBe(false);
  });

  it("이름이 맞는 파일 → 폴더로만 맞은 파일, 같으면 얕은 파일·큰 파일 순서예요", () => {
    const things = [thing("tmp/pdfs/rt89/강의노트-page.png", 900), thing("notes/old/RT4_강의노트.pdf", 10), thing("RT9_강의노트.pdf", 5), thing("RT10_강의노트.pdf", 50), thing("강의노트/표지.png", 999)];
    const found = things.filter((item) => matchesPath(item, "강의노트")).sort(searchOrder("강의노트"));
    expect(found.map((item) => item.path)).toEqual(["RT10_강의노트.pdf", "RT9_강의노트.pdf", "notes/old/RT4_강의노트.pdf", "tmp/pdfs/rt89/강의노트-page.png", "강의노트/표지.png"]);
  });

  it("상자에 든 파일은 원래 경로로 찾고, 상자 폴더 이름으로는 걸리지 않아요", () => {
    const boxed = { ...thing("_Folduct 정리상자/tmp/a.png"), box: { state: "boxed" as const, fromPath: "tmp/a.png", boxPath: "_Folduct 정리상자/tmp/a.png", at: 0 } };
    expect(matchesPath(boxed, "정리")).toBe(false);
    expect(matchesPath(boxed, "tmp a.png")).toBe(true);
  });

  it("빈칸만 있으면 찾는 중이 아니에요", () => {
    expect(isSearching("   ")).toBe(false);
    expect(isSearching(" rt ")).toBe(true);
  });
});
