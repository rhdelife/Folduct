import { describe, expect, it } from "vitest";
import { iconCoverId, iconOfCover, normalizeIcons } from "../domain/icon";
import { ductShapeCount } from "../art/duct";

describe("아이콘 보관함", () => {
  it("망가진 값은 버리거나 기본값으로 돌려요", () => {
    expect(normalizeIcons(null)).toEqual([]);
    const icons = normalizeIcons([
      { id: "a", name: "  수업  ", shape: 3, color: 2, length: 0.4, expr: "happy", at: 5 },
      { id: "a", name: "겹침" },
      { name: "id 없음" },
      { id: "b", shape: ductShapeCount, color: 99, length: 7, expr: "없는표정" },
    ]);
    expect(icons).toEqual([
      { id: "a", name: "수업", shape: 3, color: 2, length: 0.4, expr: "happy", at: 5 },
      { id: "b", name: "", shape: 0, color: 0, length: 1, expr: "base", at: 0 },
    ]);
  });

  it("방 썸네일 자리와 아이콘 id를 오가요", () => {
    expect(iconOfCover(iconCoverId("x1"))).toBe("x1");
    expect(iconOfCover("cover:room")).toBeNull();
    expect(iconOfCover(null)).toBeNull();
  });
});
