/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import faces from "../art/duct-faces.png?inline";
import { cue, onCue, type Cue } from "../components/useFrodo";
import { drawFaceFrame, drawPose, drawRoom, drawStack, stackGeometry, faceCell, faceFrames, lookExpr, poseFace, ductIndex, ductLayers, ductLength, ductMouth, ductReach, ductShapeCount, ductWeight, type DuctDrawing, type DuctPiece, type DuctPose } from "../art/duct";

const pieces = (drawing: DuctDrawing): DuctPiece[] => drawing.items.flatMap((item) => ("parts" in item ? item.parts.filter((part): part is DuctPiece => "d" in part) : [item]));
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
    // 인트로의 색은 받침에서 머리 쪽으로 차례가 매겨진 조각이고, 형식 순서대로 칠해져요.
    const flow = pieces(drawPose("idle", { px: 240, layers, flow: true })).filter((piece) => piece.tone === "layer");
    expect(flow.map((piece) => piece.i)).toEqual(flow.map((_, at) => at));
    expect(flow.every((piece) => piece.n === flow.length)).toBe(true);
    expect([...new Set(flow.map((piece) => piece.color))]).toEqual(layers.map((layer) => layer.color));
    expect(pieces(drawPose("idle", { px: 240, flow: true })).some((piece) => piece.tone === "layer")).toBe(false);
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

  it("몸 길이는 용량으로만 정해지고 모양이 바뀌어도 같아요", () => {
    expect(ductReach(0)).toBeLessThan(ductReach(0.5));
    expect(ductReach(0.5)).toBeLessThan(ductReach(1));
    // 어느 모양이든 끝까지 자라도 선을 넘지 않아요(넘으면 모양마다 잘리는 길이가 달라져요).
    for (let shape = 0; shape < ductShapeCount; shape++) expect(drawRoom(shape, 1, { px: 120 }).items.length).toBeGreaterThan(0);
  });

  it("같은 방은 늘 같은 모양이고 여덟 모양에 흩어져요", () => {
    expect(ductIndex("방-1")).toBe(ductIndex("방-1"));
    expect(new Set(Array.from({ length: 80 }, (_, i) => ductIndex(`방-${i}`))).size).toBe(ductShapeCount);
  });
});

describe("홈의 프로도 한 명", () => {
  const segs = [{ length: 0.2 }, { length: 1 }, { length: 0 }];

  it("몸은 마디 칸·색 없이 하얀 관 하나이고, 방을 먹을수록 길어요", () => {
    const drawing = drawStack(segs.map((seg) => seg.length), { px: 200, live: true });
    expect(drawing.viewBox).not.toContain("NaN");
    for (const piece of pieces(drawing)) expect(piece.d).not.toMatch(/NaN|undefined/);
    expect(pieces(drawing).some((piece) => piece.tone === "layer")).toBe(false);
    expect(drawStack(segs.map((seg) => seg.length), { px: 200, live: true })).toEqual(drawing);
    const height = (lengths: number[]) => Number(drawStack(lengths, { px: 200 }).viewBox.split(" ")[3]);
    expect(height([0.2, 1])).toBeGreaterThan(height([0.2]));
  });

  it("아무것도 안 먹은 몸이 가장 짧고, 먹은 방 용량이 클수록 길어요", () => {
    const tall = (lengths: number[]) => stackGeometry(lengths).box[3];
    expect(tall([0])).toBeGreaterThan(tall([]));
    expect(tall([0.5])).toBeGreaterThan(tall([0]));
    expect(tall([1])).toBeGreaterThan(tall([0.5]));
    const geo = stackGeometry([0.5]);
    expect(geo.mouth[1]).toBeLessThan(geo.segs[0].top);
    expect(drawStack([], { px: 200 }).viewBox).not.toContain("NaN");
  });

  it("먹은 방의 형식 색은 받침부터 용량 비율만큼 한 띠씩 칠하고, 색이 없으면 하얀 몸이에요", () => {
    const filled = pieces(drawStack([0.5], { px: 200, live: true, layers })).filter((piece) => piece.tone === "layer");
    // 조각으로 나누지 않아요. 차오르는 움직임은 가림 하나가 맡아요(RoomFace wipe).
    expect(filled).toHaveLength(layers.length);
    // 받침 쪽 70%는 영상 색, 머리 쪽은 글·코드 색이에요.
    expect(filled[0].color).toBe(layers[0].color);
    expect(filled[filled.length - 1].color).toBe(layers[1].color);
    expect(pieces(drawStack([0.5], { px: 200, live: true })).some((piece) => piece.tone === "layer")).toBe(false);
  });
});

describe("프로도의 표정과 신호", () => {
  it("표정 시트는 프레임 수와 칸 크기에 맞고, 모든 프레임이 망가지지 않았어요", () => {
    const png = atob(faces.split(",")[1]);
    const u32 = (at: number) => [0, 1, 2, 3].reduce((sum, i) => sum * 256 + png.charCodeAt(at + i), 0);
    expect([u32(16), u32(20)]).toEqual([faceCell.width * faceFrames.length, faceCell.height]);
    expect(new Set(faceFrames.map((_, at) => JSON.stringify(drawFaceFrame(at)))).size).toBe(faceFrames.length);
    for (const face of Object.values(poseFace)) expect(faceFrames).toContain(face);
  });

  it("커서 쪽을 여덟 방향으로 바라봐요", () => {
    expect(lookExpr(10, 0)).toBe("lookR");
    expect(lookExpr(-10, 0)).toBe("lookL");
    expect(lookExpr(0, -10)).toBe("lookU");
    expect(lookExpr(0, 10)).toBe("lookD");
    expect(lookExpr(10, -10)).toBe("lookUR");
    expect(lookExpr(-10, 10)).toBe("lookDL");
  });

  it("살아 있는 그림은 얼굴 자리와 움직일 부위를 내주고, 정지 그림은 그대로예요", () => {
    const parts = (drawing: { items: unknown[] }) => drawing.items.flatMap((item) => ((item as { part?: string }).part ? [(item as { part: string }).part] : []));
    expect(parts(drawRoom(0, 0.5, { px: 120, live: true }))).toEqual(["armL", "armR", "head"]);
    expect(parts(drawPose("idle", { px: 104, live: true }))).toEqual(["armL", "armR", "head"]);
    expect(parts(drawRoom(0, 0.5, { px: 120 }))).toEqual([]);
    const head = drawRoom(0, 0.5, { px: 120, live: true }).items.find((item) => "part" in item && item.part === "head");
    expect(head && "parts" in head && head.parts.some((part) => "face" in part)).toBe(true);
  });

  it("신호는 그 프로도에게만 가고, 그려지기 전에 온 신호는 잠깐 맡아 둬요", () => {
    const heard: Cue[] = [];
    const stop = onCue("방-가", (next) => heard.push(next));
    cue("방-가", { body: "wave" });
    cue("방-나", { body: "hop" });
    expect(heard).toEqual([{ body: "wave" }]);
    stop();
    const late: Cue[] = [];
    onCue("방-나", (next) => late.push(next));
    expect(late).toEqual([{ body: "hop" }]);
  });
});
