import { describe, expect, it } from "vitest";
import { paperArts } from "../art/paperArts";
import { blankPaper, iconArt, normalizeKindIcons, type KindIcon } from "../domain/kindIcon";

const icon: KindIcon = { id: "a", name: "내 영상", kind: "video", base: paperArts.video[1].id, at: 5, strokes: [
  { tool: "pen", pts: [10, 10, 20, 20, 30, 15], fill: false },
  { tool: "ring", pts: [20, 20, 40, 40], fill: true },
] };

describe("파일 형식 아이콘", () => {
  it("바탕 종이의 판과 이름 칸을 그대로 두고 선을 더해요", () => {
    const base = paperArts.video[1];
    const art = iconArt(icon);
    expect([art.w, art.h, art.slot]).toEqual([base.w, base.h, base.slot]);
    // 펜 선 하나 + 채운 원(면과 선) = 3칸
    expect(art.parts.length).toBe(base.parts.length + 3);
    expect(art.parts.at(-2)).toMatchObject({ fill: "color" });
    expect(iconArt({ ...icon, at: 6 }).id).not.toBe(art.id);
  });

  it("망가진 기록은 버리고 점은 종이 안으로 넣어요", () => {
    const store = normalizeKindIcons({
      icons: [
        { ...icon, base: "없는종이", strokes: [{ tool: "pen", pts: [-50, 0, 999, 999] }, { tool: "laser", pts: [1, 2, 3, 4] }, { tool: "box", pts: [1] }] },
        { ...icon, name: "겹친 id" },
        { id: "b", kind: "없는형식" },
      ],
      use: { video: "a", image: "a", pdf: "nope" },
    });
    expect(store.icons).toHaveLength(1);
    expect(store.icons[0].base).toBe("blank");
    expect(store.icons[0].strokes).toEqual([{ tool: "pen", pts: [6, 6, blankPaper.w - 6, blankPaper.h - 6], fill: false }]);
    // 다른 형식에 붙은 아이콘이나 없는 아이콘은 기본 종이로 돌아가요.
    expect(store.use).toEqual({ video: "a" });
    expect(normalizeKindIcons(undefined)).toEqual({ icons: [], use: {} });
  });
  it("점은 누르기만 해도 찍히고, 고른 색 단은 그 형식 색 안에서만 남아요", () => {
    const icon: KindIcon = { id: "d", name: "점", kind: "image", base: blankPaper.id, at: 1, strokes: [
      { tool: "dot", pts: [50, 50, 50, 50], fill: false },
      { tool: "pen", pts: [10, 10, 40, 40], fill: false, tone: "soft" },
      { tool: "box", pts: [20, 20, 60, 60], fill: true, tone: "edge" },
    ] };
    const parts = iconArt(icon).parts;
    expect(parts[0]).toMatchObject({ fill: "ink" });
    expect(parts[2]).toMatchObject({ pen: 0.7, tone: "soft" });
    expect(parts[3]).toMatchObject({ fill: "edge" });
    const read = normalizeKindIcons({ icons: [{ ...icon, strokes: [{ tool: "dot", pts: [50, 50, 90, 90], fill: false, tone: "#ff0000" }] }] });
    expect(read.icons[0].strokes[0]).toEqual({ tool: "dot", pts: [50, 50, 90, 90], fill: false });
  });
  it("이미지 아이콘은 작은 그림 data URL만 남기고, 다른 값은 버려요", () => {
    const base = { id: "i", name: "그림", kind: "pdf", base: blankPaper.id, strokes: [], at: 1 };
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(normalizeKindIcons({ icons: [{ ...base, image: png }] }).icons[0].image).toBe(png);
    for (const bad of ["https://example.com/a.png", "data:text/html;base64,PHA+", `data:image/png;base64,${"A".repeat(700_000)}`, 3]) {
      expect(normalizeKindIcons({ icons: [{ ...base, image: bad }] }).icons[0]).not.toHaveProperty("image");
    }
  });
});
