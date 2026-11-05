import { describe, expect, it } from "vitest";
import { drawPose, drawRoom, ductIndex, ductLayers, ductLength, ductMouth, ductShapeCount, ductWeight, type DuctDrawing, type DuctPiece, type DuctPose } from "../art/duct";

const pieces = (drawing: DuctDrawing): DuctPiece[] => drawing.items.flatMap((item) => ("parts" in item ? item.parts : [item]));
const allPoses: DuctPose[] = ["idle", "watch", "offer", "move", "done", "rest", "shock"];
const layers = [{ label: "영상", color: "#2a64ad", share: 0.7 }, { label: "글·코드", color: "#5f9b6d", share: 0.3 }];

describe("주름관 그림", () => {
  it("같은 값이면 언제나 같은 선이에요", () => {
    expect(drawRoom(3, 0.5, { px: 120, layers })).toEqual(drawRoom(3, 0.5, { px: 120, layers }));
    expect(drawPose("watch", { px: 104 })).toEqual(drawPose("watch", { px: 104 }));
  });

  it("모든 모양과 자세에 망가진 좌표가 없어요", () => {
    const drawings = [...allPoses.map((pose) => drawPose(pose, { px: 104, layers })), ...Array.from({ length: ductShapeCount }, (_, shape) => [0, 0.5, 1].map((length) => drawRoom(shape, length, { px: 120, layers }))).flat()];
    for (const drawing of drawings) {
      expect(drawing.viewBox).not.toContain("NaN");
      for (const piece of pieces(drawing)) expect(piece.d).not.toMatch(/NaN|undefined/);
    }
  });

  it("자세 7가지는 서로 달라요", () => {
    expect(new Set(allPoses.map((pose) => JSON.stringify(drawPose(pose, { px: 104 })))).size).toBe(allPoses.length);
  });

  it("옮기는 동안에는 주름이 한 칸씩 움직이고 파일을 들고 있어요", () => {
    const moving = drawPose("move", { px: 104 }).items.filter((item) => "parts" in item);
    expect(moving.filter((item) => "rib" in item && item.rib !== undefined).length).toBeGreaterThan(3);
    expect(pieces(drawPose("move", { px: 104 })).some((piece) => piece.tone === "paper")).toBe(true);
    expect(pieces(drawPose("offer", { px: 104 })).some((piece) => piece.tone === "paper")).toBe(true);
    expect(pieces(drawPose("idle", { px: 104 })).some((piece) => piece.tone === "paper")).toBe(false);
  });

  it("용량이 크면 관이 길어져 머리가 받침에서 멀어져요", () => {
    for (let shape = 0; shape < ductShapeCount; shape += 1) {
      const short = ductMouth(shape, 0);
      const long = ductMouth(shape, 1);
      expect(long.y).toBeLessThan(short.y);
    }
  });

  it("그림이 판 밖으로 크게 벗어나지 않아요", () => {
    for (let shape = 0; shape < ductShapeCount; shape += 1) {
      for (const length of [0, 0.5, 1]) {
        const { x, y } = ductMouth(shape, length);
        expect(Math.abs(x)).toBeLessThan(0.5);
        expect(Math.abs(y)).toBeLessThan(0.5);
      }
    }
  });

  it("주름 색은 형식별 용량 비율이고, 파일이 없으면 칠하지 않아요", () => {
    expect(ductLayers([{ label: "영상", color: "#000", size: 30 }, { label: "표", color: "#111", size: 10 }]).map((layer) => layer.share)).toEqual([0.75, 0.25]);
    expect(ductLayers([])).toEqual([]);
    const painted = pieces(drawRoom(0, 0.8, { px: 120, layers })).filter((piece) => piece.tone === "layer");
    expect(painted.map((piece) => piece.color)).toEqual(layers.map((layer) => layer.color));
    expect(pieces(drawRoom(0, 0.8, { px: 120 })).some((piece) => piece.tone === "layer")).toBe(false);
  });

  it("아주 작으면 실루엣으로 그리고, 크면 선을 얇게 그려요", () => {
    expect(pieces(drawRoom(0, 0.8, { px: 20, layers })).some((piece) => piece.tone === "solid")).toBe(true);
    expect(pieces(drawRoom(0, 0.8, { px: 120, layers })).some((piece) => piece.tone === "solid")).toBe(false);
    expect(ductWeight(300)).toBeLessThan(ductWeight(72));
  });

  it("용량이 클수록 길고, 끝은 정해져 있어요", () => {
    const GB = 1024 ** 3;
    expect(ductLength(0)).toBe(0);
    expect(ductLength(80 * 1024 * 1024)).toBeLessThan(ductLength(4 * GB));
    expect(ductLength(4 * GB)).toBeLessThan(ductLength(38 * GB));
    expect(ductLength(1024 * GB)).toBe(1);
  });

  it("같은 방은 늘 같은 모양이고 여덟 모양에 흩어져요", () => {
    expect(ductIndex("방-1")).toBe(ductIndex("방-1"));
    expect(new Set(Array.from({ length: 80 }, (_, i) => ductIndex(`방-${i}`))).size).toBe(ductShapeCount);
  });
});
