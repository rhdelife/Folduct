import { describe, expect, it } from "vitest";
import { formatMB, formatMinutes, rangeText, sizeSteps, stepAt, stepEnd, stepValue } from "../domain/stepRange";

describe("서랍 범위 바", () => {
  it("빈 값은 양 끝 자리, 저장 값은 가까운 눈금", () => {
    expect(stepAt(sizeSteps, undefined, "low")).toBe(0);
    expect(stepAt(sizeSteps, undefined, "high")).toBe(stepEnd(sizeSteps));
    expect(stepAt(sizeSteps, 10, "low")).toBe(3);
    expect(stepAt(sizeSteps, 900, "high")).toBe(7);
  });
  it("양 끝 자리는 조건 없음, 가운데는 눈금 값", () => {
    expect(stepValue(sizeSteps, 0)).toBeUndefined();
    expect(stepValue(sizeSteps, stepEnd(sizeSteps))).toBeUndefined();
    expect(stepValue(sizeSteps, 1)).toBe(1);
    expect(stepValue(sizeSteps, 8)).toBe(5120);
  });
  it("범위 글", () => {
    expect(rangeText(undefined, undefined, formatMB)).toBe("전체");
    expect(rangeText(10, undefined, formatMB)).toBe("10MB 이상");
    expect(rangeText(undefined, 1024, formatMB)).toBe("1GB 미만");
    expect(rangeText(5, 120, formatMinutes)).toBe("5분 ~ 2시간");
  });
});
