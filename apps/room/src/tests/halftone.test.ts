import { describe, expect, it } from "vitest";
import { fitBand, fitToSquare, halftoneDots, isCutout, subjectBox, type Pixels } from "../domain/halftone";

// 칸마다 [밝기, 알파]를 정하는 작은 이미지.
function image(width: number, height: number, at: (x: number, y: number) => [number, number]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [lum, alpha] = at(x, y);
      data.set([lum, lum, lum, alpha], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

const square = (lum: (x: number) => number = () => 100) => image(40, 40, (x, y) => (x >= 10 && x < 30 && y >= 5 && y < 25 ? [lum(x), 255] : [0, 0]));

describe("배경이 빠진 이미지", () => {
  it("투명한 곳과 물체가 함께 있어야 해요", () => {
    expect(isCutout(square())).toBe(true);
    expect(isCutout(image(40, 40, () => [100, 255]))).toBe(false);
    expect(isCutout(image(40, 40, () => [0, 0]))).toBe(false);
  });

  it("물체가 차지한 범위를 찾아요", () => {
    expect(subjectBox(square())).toEqual({ x: 10, y: 5, w: 20, h: 20 });
    expect(subjectBox(image(4, 4, () => [0, 0]))).toBeNull();
  });
});

describe("정사각형에 맞추기", () => {
  it("가로로 긴 물체는 가운데 바닥에 붙어요", () => {
    expect(fitToSquare(200, 100, 256)).toEqual({ x: 0, y: 128, w: 256, h: 128 });
  });

  it("세로로 긴 물체는 위아래를 채우고 가운데에 놓여요", () => {
    expect(fitToSquare(100, 200, 256)).toEqual({ x: 64, y: 0, w: 128, h: 256 });
  });
});

describe("망점", () => {
  it("물체 안에만 찍어요", () => {
    for (const dot of halftoneDots(square(), 4)) {
      expect(dot.x).toBeGreaterThanOrEqual(10);
      expect(dot.x).toBeLessThan(30);
      expect(dot.y).toBeGreaterThanOrEqual(5);
      expect(dot.y).toBeLessThan(25);
    }
    expect(halftoneDots(square(), 4).length).toBeGreaterThan(0);
  });

  it("어두울수록 점이 커요", () => {
    const dots = halftoneDots(square((x) => (x < 20 ? 20 : 220)), 4);
    const dark = dots.find((dot) => dot.x < 20)!;
    const light = dots.find((dot) => dot.x >= 20)!;
    expect(dark.r).toBeGreaterThan(light.r);
  });

  it("칸이 굵으면 점 수가 줄고 점은 커져요", () => {
    const fine = halftoneDots(square((x) => x * 6), 4);
    const coarse = halftoneDots(square((x) => x * 6), 8);
    expect(coarse.length).toBeLessThan(fine.length);
    expect(Math.max(...coarse.map((dot) => dot.r))).toBeGreaterThan(Math.max(...fine.map((dot) => dot.r)));
  });

  it("밝기가 한 가지여도 NaN 없이 찍어요", () => {
    for (const dot of halftoneDots(square(), 4)) expect(Number.isFinite(dot.r)).toBe(true);
  });

  it("빈 이미지는 점이 없어요", () => {
    expect(halftoneDots(image(8, 8, () => [0, 0]), 4)).toEqual([]);
  });
});

describe("층을 물체 높이에 맞추기", () => {
  it("바닥은 그대로 두고 높이만 줄여요", () => {
    expect(fitBand({ y: 0, height: 100 }, 0.5)).toEqual({ y: 50, height: 50 });
    expect(fitBand({ y: 0, height: 100 }, 1)).toEqual({ y: 0, height: 100 });
  });

  it("다른 칸은 지켜요", () => {
    expect(fitBand({ label: "영상", y: 50, height: 50 }, 0.5).label).toBe("영상");
  });
});
