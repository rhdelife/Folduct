import { describe, expect, it } from "vitest";
import { jarLayers } from "../domain/jar";

const size = (bytes: number, count = 1) => ({ bytes, count });

describe("한 병의 층", () => {
  it("빈 형식은 층이 없고, 파일이 없으면 병도 비어요", () => {
    expect(jarLayers([size(0, 0), size(0, 0)])).toEqual([]);
    expect(jarLayers([size(0, 0), size(100)]).map((layer) => layer.at)).toEqual([1]);
  });

  it("큰 층이 아래에 오고 틈 없이 어깨까지 차요", () => {
    const layers = jarLayers([size(1024), size(5 * 1024 ** 3), size(1024 ** 2)]);
    expect(layers.map((layer) => layer.at)).toEqual([1, 2, 0]);
    expect(layers[0].y + layers[0].height).toBeCloseTo(100);
    expect(layers[1].y + layers[1].height).toBeCloseTo(layers[0].y);
    expect(layers[2].y).toBeCloseTo(-52);
    expect(layers[0].height).toBeGreaterThan(layers[2].height);
  });

  it("작은 층도 누를 만큼 두껍고, 0바이트만 있어도 NaN이 나지 않아요", () => {
    const layers = jarLayers([size(5 * 1024 ** 4), ...Array.from({ length: 8 }, () => size(10))]);
    for (const layer of layers) expect(layer.height).toBeGreaterThanOrEqual((152 / 9) * 0.55);
    expect(jarLayers([size(0), size(0)]).map((layer) => layer.height)).toEqual([76, 76]);
  });
});
