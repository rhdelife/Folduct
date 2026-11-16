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
});
