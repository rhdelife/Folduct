import { describe, expect, it } from "vitest";
import { canvasHeight, canvasMinHeight, canvasScale, canvasWidth, listAt, nextSpot, normalizeCanvas, rangeIds } from "../domain/canvas";
import { normalizeRoom } from "../storage/db";
import type { Thing } from "../domain/model";

const thing = (id: string, path: string, size = 10, box = false): Thing =>
  ({ id, path, name: path.split("/").pop()!, kind: "text", size, lastModified: size, lastUsedAt: null, missing: false, spot: null, note: "", touchedAt: null, seenAt: 0, pinned: false, box: box ? ({ state: "in" } as unknown as Thing["box"]) : null });

describe("방 판(빈 캔버스)", () => {
  it("예전 방 기록은 빈 판으로 옮겨요", () => {
    const room = normalizeRoom({ id: "r", name: "방", things: [], care: {}, scan: {} });
    expect(room.canvas).toEqual([]);
  });

  it("망가진 칸은 버리고 자리·크기는 판 안으로 넣어요", () => {
    const items = normalizeCanvas([
      { key: "t:a", x: -20, y: 30, s: 9 },
      { key: "t:a", x: 1, y: 1, s: 1 },
      { key: "x:b", x: 1, y: 1, s: 1 },
      { key: "f:src", x: 99999, y: -5 },
      { key: "t:c", x: "1", y: 2 },
    ]);
    expect(items.map((item) => item.key)).toEqual(["t:a", "f:src"]);
    expect(items[0]).toMatchObject({ x: 0, y: 30, s: canvasScale.max });
    expect(items[1].y).toBe(0);
    expect(items[1].x).toBeLessThan(canvasWidth);
    expect(normalizeCanvas("nope")).toEqual([]);
  });

  it("새로 꺼낸 것은 비어 있는 다음 칸에 놓여요", () => {
    const first = nextSpot([]);
    const second = nextSpot([{ key: "t:a", ...first, s: 1 }]);
    expect(second).not.toEqual(first);
    expect(canvasHeight([])).toBe(canvasMinHeight);
  });

  it("폴더 바로 아래의 폴더와 파일을 나눠요(상자 속은 빼요)", () => {
    const things = [thing("1", "a.md"), thing("2", "src/x.ts", 5), thing("3", "src/y/z.ts", 7), thing("4", "img/p.png", 30), thing("5", "old.md", 1, true)];
    const top = listAt(things, "");
    expect(top.files.map((t) => t.id)).toEqual(["1"]);
    expect(top.folders.map((f) => [f.path, f.things.length, f.size])).toEqual([["img", 1, 30], ["src", 2, 12]]);
    const src = listAt(things, "src");
    expect(src.files.map((t) => t.id)).toEqual(["2"]);
    expect(src.folders.map((f) => f.path)).toEqual(["src/y"]);
  });
});

describe("꺼내기 범위 고르기", () => {
  it("앞서 누른 카드부터 지금 카드까지, 거꾸로 눌러도 같은 범위예요", () => {
    const order = ["a", "b", "c", "d"];
    expect(rangeIds(order, "b", "d")).toEqual(["b", "c", "d"]);
    expect(rangeIds(order, "d", "b")).toEqual(["b", "c", "d"]);
    expect(rangeIds(order, null, "c")).toEqual(["c"]);
    expect(rangeIds(order, "사라짐", "c")).toEqual(["c"]);
  });
});
