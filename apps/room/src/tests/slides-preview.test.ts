import { describe, expect, it } from "vitest";
import { pxLengths, safeImageSource, slideWidth } from "../domain/slides";

describe("Quick Look 발표 미리보기", () => {
  it("단위 없는 길이에 px를 붙이고, 단위 없는 숫자가 뜻 있는 속성은 그대로 둬요", () => {
    expect(pxLengths("position:absolute; top:93; left:36; width:432; height:270;")).toBe("position:absolute; top:93px; left:36px; width:432px; height:270px;");
    expect(pxLengths(".s2.s2.s2 {font-family:\"Pretendard\"; font-size:44;}")).toBe(".s2.s2.s2 {font-family:\"Pretendard\"; font-size:44px;}");
    expect(pxLengths("margin-left:16px; text-indent:-16px; font-size: 16; line-height:1.2; font-weight:700; z-index:3; opacity:0.5")).toBe("margin-left:16px; text-indent:-16px; font-size: 16px; line-height:1.2; font-weight:700; z-index:3; opacity:0.5");
    expect(pxLengths("top:0; left:0;")).toBe("top:0; left:0;");
    expect(pxLengths("div.slide, div.loading-slide { width: 960; height: 540;}")).toBe("div.slide, div.loading-slide { width: 960px; height: 540px;}");
  });

  it("슬라이드 폭은 viewport meta에서, 없거나 이상하면 976", () => {
    expect(slideWidth('<meta name="viewport" content="width=976, maximum-scale=4.0">')).toBe(976);
    expect(slideWidth('<meta name="viewport" content="width=736">')).toBe(736);
    expect(slideWidth("<html></html>")).toBe(976);
    expect(slideWidth('<meta name="viewport" content="width=5">')).toBe(976);
  });

  it("그림은 data URL만 받아요", () => {
    expect(safeImageSource("data:image/png;base64,YQ==")).toBe(true);
    expect(safeImageSource("Attachment1.png")).toBe(false);
    expect(safeImageSource("https://example.com/a.png")).toBe(false);
    expect(safeImageSource("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
    expect(safeImageSource(null)).toBe(false);
  });
});
