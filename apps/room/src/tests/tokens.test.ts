import { describe, expect, it } from "vitest";
import { toMs } from "../components/tokens";

describe("시간 토큰", () => {
  it("빌드가 줄여 쓴 초 단위도 ms로 읽는다", () => {
    expect(toMs("640ms")).toBe(640);
    expect(toMs(".64s")).toBe(640);
    expect(toMs("1s")).toBe(1000);
    expect(toMs(" 120ms")).toBe(120);
    expect(toMs("")).toBe(0);
  });
});
