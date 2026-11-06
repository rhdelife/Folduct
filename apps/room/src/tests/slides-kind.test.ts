import { describe, expect, it } from "vitest";
import { colorGroups, kindColors } from "../art/palette";
import { normalizeDoorstep } from "../domain/doorstep";
import { kindLabels, kindOf, storedKind } from "../domain/model";
import { normalizeRoom } from "../storage/db";

describe("발표 형식", () => {
  it("발표 파일은 문서에서 갈라져 발표가 돼요", () => {
    for (const name of ["a.key", "b.ppt", "c.PPTX", "d.odp"]) expect(kindOf(name), name).toBe("slides");
    for (const name of ["a.docx", "b.hwp", "c.pages", "d.odt"]) expect(kindOf(name), name).toBe("office");
    expect(kindLabels.slides).toBe("발표");
  });

  it("발표는 제 색 묶음을 갖고, PDF·문서 빨강과 다른 색이에요", () => {
    const group = colorGroups.find((item) => item.kinds.includes("slides"));
    expect(group?.label).toBe("발표");
    expect(kindColors.slides).not.toBe(kindColors.office);
    expect(colorGroups.flatMap((item) => item.kinds).filter((kind) => kind === "slides")).toHaveLength(1);
  });
});

describe("예전 기록 옮기기", () => {
  it("'문서'로 저장된 발표 파일만 발표로 옮기고, 나머지 저장된 형식은 그대로 둬요", () => {
    expect(storedKind("office", "발표.pptx")).toBe("slides");
    expect(storedKind("office", "기획서.docx")).toBe("office");
    expect(storedKind("image", "표지.key")).toBe("image");
    expect(storedKind("slides", "발표.key")).toBe("slides");
  });

  it("모르거나 망가진 형식은 이름으로 다시 정해요", () => {
    for (const kind of [undefined, null, 3, "없는 형식", "constructor", "toString"]) expect(storedKind(kind, "메모.txt"), String(kind)).toBe("text");
  });

  it("방을 열면 예전 '문서' 발표 파일이 발표가 되고, 다른 칸은 그대로예요", () => {
    const thing = { id: "t", path: "a/발표.key", name: "발표.key", kind: "office", size: 10, lastModified: 5, lastUsedAt: null, note: "메모", pinned: true };
    const room = normalizeRoom({ id: "r", name: "방", createdAt: 1, things: [thing, { ...thing, id: "t2", path: "a/기획.docx", name: "기획.docx" }] });
    expect(room.things.map((item) => item.kind)).toEqual(["slides", "office"]);
    expect(room.things[0]).toMatchObject({ note: "메모", pinned: true, size: 10 });
  });

  it("현관 줄도 같은 규칙으로 옮기고, 형식이 없던 줄은 이름으로 채워요", () => {
    const item = { id: "d", folder: "/f", path: "/f/발표.pptx", name: "발표.pptx", kind: "office", size: 1, lastModified: 1, since: 1 };
    const state = normalizeDoorstep({ folders: ["/f"], items: [item, { ...item, id: "d2", kind: undefined }, { ...item, id: "d3", name: "기획.docx", path: "/f/기획.docx" }] });
    expect(state.items.map((door) => door.kind)).toEqual(["slides", "slides", "office"]);
  });
});
