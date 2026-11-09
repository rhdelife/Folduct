import { describe, expect, it } from "vitest";
import { hueOf, mainHue } from "../domain/hue";

const pixels = (...colors: [number, number, number, number, number][]) =>
  colors.flatMap(([r, g, b, a, times]) => Array.from({ length: times }, () => [r, g, b, a]).flat());

describe("이미지 색 묶기", () => {
  it("화소 하나를 색 이름으로 나눠요", () => {
    expect(hueOf(220, 30, 30)).toBe("빨강");
    expect(hueOf(240, 140, 20)).toBe("주황");
    expect(hueOf(240, 220, 40)).toBe("노랑");
    expect(hueOf(40, 170, 70)).toBe("초록");
    expect(hueOf(30, 90, 220)).toBe("파랑");
    expect(hueOf(130, 50, 200)).toBe("보라");
    expect(hueOf(240, 100, 180)).toBe("분홍");
    expect(hueOf(110, 60, 20)).toBe("갈색");
    expect(hueOf(250, 250, 250)).toBe("흰색");
    expect(hueOf(128, 128, 128)).toBe("회색");
    expect(hueOf(10, 10, 12)).toBe("검정");
  });

  it("흰 바탕 위 사물은 사물 색으로 봐요", () => {
    expect(mainHue(pixels([255, 255, 255, 255, 70], [30, 90, 220, 255, 30]))).toBe("파랑");
  });

  it("다른 색이 아주 조금이면 바탕색으로 봐요", () => {
    expect(mainHue(pixels([255, 255, 255, 255, 90], [30, 90, 220, 255, 10]))).toBe("흰색");
  });

  it("투명한 곳은 세지 않고, 다 투명하면 색을 모른다고 해요", () => {
    expect(mainHue(pixels([0, 0, 0, 0, 90], [220, 30, 30, 255, 10]))).toBe("빨강");
    expect(mainHue(pixels([0, 0, 0, 0, 10]))).toBeNull();
  });
});
